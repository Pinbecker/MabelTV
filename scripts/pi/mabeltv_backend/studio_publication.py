"""Canonical names for completed Studio film uploads, with resumable renames."""
from copy import deepcopy
from pathlib import Path

from .constants import SAFE_NAME


def publication_file(library, upload_id):
    receipt = library.upload_status(str(upload_id))
    if not receipt.get("complete") or receipt.get("kind") != "my_tv":
        raise ValueError("Choose a completed My TV film upload")
    journal = receipt.get("title_rename")
    if journal:
        resume_rename(library, receipt)
    source = library.upload_destination(receipt)
    if not source.is_file() or source.stat().st_size != receipt.get("offset"):
        raise ValueError("The published film changed; its filename was kept")
    return receipt, source


def rename_publication(library, receipt, title):
    """Only the verified upload can be renamed; never overwrite another film."""
    with library.config_lock:
        receipt, source = publication_file(library, receipt["id"])
        year = str(title.get("release_date", ""))[:4]
        name = SAFE_NAME.sub("", str(title.get("title", ""))).strip(". ")[:160]
        if not name:
            raise ValueError("The catalogue did not supply a film title")
        destination = source.with_name(name + (f" ({year})" if year.isdigit() and len(year) == 4 else "") + source.suffix)
        if source == destination:
            return receipt
        pairs = [(source, destination)] + [(sidecar, sidecar.with_name(destination.stem + sidecar.name[len(source.stem):]))
                                             for sidecar in library.subtitle_sidecars(source)]
        if any(target.exists() for _, target in pairs):
            raise ValueError("That film name already exists; both copies were kept")
        receipt["title_rename"] = {"moves": [[library.my_tv_relative_path(old), library.my_tv_relative_path(new)]
                                           for old, new in pairs]}
        # The upload receipt is already an operational journal outside SQLite.
        library.write_json(library.incoming / (receipt["id"] + ".result.json"), receipt)
        resume_rename(library, receipt)
        return receipt


def resume_rename(library, receipt):
    """Retry safely if stopped between a media move, state write and receipt write."""
    with library.config_lock:
        moves = receipt["title_rename"]["moves"]
        original = library.safe_my_tv_path(moves[0][0])
        target = library.safe_my_tv_path(moves[0][1])
        for index, (old, new) in enumerate(moves):
            if index and (Path(old).parent != Path(moves[0][0]).parent or Path(new).parent != Path(moves[0][1]).parent
                          or not Path(old).name.startswith(original.stem + ".")
                          or not Path(new).name.startswith(target.stem + ".")):
                raise ValueError("The subtitle rename journal is invalid")
            source, destination = original.parent / Path(old).name, target.parent / Path(new).name
            if source.exists():
                if destination.exists():
                    raise ValueError("That film name already exists; both copies were kept")
                source.rename(destination)
            elif not destination.is_file():
                raise ValueError("The published film could not finish renaming")
        old, new = moves[0]
        states = library.my_tv_media_states()
        if old in states:
            if new in states:
                raise ValueError("That film identity already exists; the rename needs review")
            state = deepcopy(states.pop(old))
            subtitles = state.get("metadata", {}).get("subtitles", {})
            renamed = {Path(source).name: Path(target).name for source, target in moves[1:]}
            if subtitles.get("file") in renamed:
                subtitles["file"] = renamed[subtitles["file"]]
            states[new] = state
            library.write_my_tv_media_states(states)
        receipt["file_name"] = Path(new).name
        receipt["folder"] = str(Path(new).parent) if str(Path(new).parent) != "." else ""
        # Keep original-recovery and backup receipts attached to the renamed copy.
        for delivery in library.state_database.studio_records("delivery"):
            changed = False
            for record in (delivery.get("result"), delivery.get("provenance", {}).get("pi")):
                if isinstance(record, dict) and record.get("id") == receipt["id"]:
                    record.update(file_name=receipt["file_name"], folder=receipt["folder"])
                    changed = True
            if changed:
                library.state_database.studio_add("delivery", delivery)
        receipt.pop("title_rename", None)
        library.write_json(library.incoming / (receipt["id"] + ".result.json"), receipt)
