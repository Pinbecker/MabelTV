"""Atomic channel ordering without replacing stable channel identities."""

from __future__ import annotations


class ChannelOrderRepositoryMixin:
    def reorder_channels(self, order: list[dict], new_channel: dict | None = None) -> None:
        with self.transaction() as db:
            rows = [dict(row) for row in db.execute(
                "SELECT number,name,folder,aspect,content_type FROM channels ORDER BY number")]
            current = {row["folder"]: row for row in rows}
            if (not isinstance(order, list) or len(order) != len(rows)
                    or any(not isinstance(item, dict)
                           or not isinstance(item.get("folder"), str)
                           or type(item.get("number")) is not int for item in order)
                    or len({item.get("folder") for item in order}) != len(rows)
                    or {item.get("folder"): item.get("number") for item in order}
                    != {row["folder"]: row["number"] for row in rows}):
                raise ValueError("The channel list changed. Refresh it and try again.")
            if new_channel is not None and len(rows) >= 999:
                raise ValueError("All channel numbers are in use")
            occupied = {row["number"]: row for row in rows}
            for number, item in enumerate(order, 1):
                row = current[item["folder"]]
                if row["number"] == number:
                    continue
                other = occupied.get(number)
                if other is not None:
                    spare = next((value for value in range(1, 1000)
                                  if value not in occupied), None)
                    if spare is None:
                        raise ValueError("A free channel number is needed to change the order")
                    self._move_ordered_channel(db, occupied, other, spare)
                self._move_ordered_channel(db, occupied, row, number)
            if new_channel is not None:
                fields = self._channel_fields({**new_channel, "number": len(rows) + 1})
                db.execute("INSERT INTO channels(number,name,folder,aspect,content_type) "
                           "VALUES(?,?,?,?,?)", fields)
                self._bump_revisions(db, "channels")

    def _move_ordered_channel(self, db, occupied: dict, row: dict, number: int) -> None:
        original = row["number"]
        fields = self._channel_fields({**row, "number": number})
        self._update_channel(db, original, fields)
        old_prefix = f"{original}/"
        db.execute("UPDATE channel_film_resume SET media_key=? || substr(media_key,?) "
                   "WHERE media_key LIKE ?", (f"{number}/", len(old_prefix) + 1, old_prefix + "%"))
        del occupied[original]
        row["number"] = number
        occupied[number] = row
