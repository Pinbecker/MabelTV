# Playlists, Stories and Family Memories

## Where to find them

MabelTV Watch has four tabs on one line: **Episodes**, **Films**, **Playlists**
and **Stories**. Family Memories is a **Photos & Videos channel**, accessed from
its channel card beneath the episode channels and through the normal fixed
channel header. It is not a separate Watch tab.

## Playlists

The Playlists tab browses your saved afternoons with a fan of their programme
artwork. Tap one to open its own page. Back returns to the playlist browser;
its fixed phone header keeps the playlist name and playback actions available.
Returning to the Playlists tab refreshes its data without rebuilding unchanged
cards, keeping their decoded artwork mounted so the thumbnails do not flash.

Open the normal menu for a MabelTV film or episode and choose **Add to
playlist**. Choose a saved playlist or create one in that menu. The Playlists
tab lets you rename a list, remove items with confirmation, and change their
order using up/down arrows. Rows visibly swap positions; dragging is not used.
Reordering moves the existing rows immediately, preserving their artwork and
focus while saves run in order in the background. Failed saves restore the
confirmed order; other playlist actions wait for pending order changes.

**Play playlist on TV** copies the saved list into the active Up Next queue.
Replacing a nonempty queue asks for confirmation. **Add to Up Next** appends a
copy without interrupting the current programme. Editing a saved playlist never
changes an already playing copy. Missing programmes stay identifiable in the
saved list but cannot be copied into a playing queue.

**Repeat playlist** makes a playing copy repeat until stopped. The queue's
ending control can turn repeat off. Clearing the active queue also clears its
repeat snapshot. Existing queue playback, current-item overlays, remote skip
and the All Done screen continue to apply.

## Stories and Storytime

In **Stories**, choose **Add a story**, give it a name, then choose its audio files
and one illustration. Choose one recording or select all of the book's chapter
files together. Numbered filenames are ordered naturally (1, 2, then 10), and
the Pi prepares one continuous recording. Both audio and illustration must
finish preparation before listening is enabled.
The original uploads are retained. A story can be renamed or removed, with
confirmation before removal.

**Listen on TV** opens a personalised ornate storybook. Its cover reads
the configured child's name followed by **Storytime**. The book opens to the
story title and the whole illustration; the audio then plays with pause,
15-second seeking, restart and progress/resume support. This is a separate
listening scene without a television surround or numbered audio channels.

**Open Storytime** offers **On TV** and **On this device** in the normal
destination menu. **On TV** opens a catalogue on the stone floor, with two rows
of titled books. Arrows browse books and pages of the catalogue; a selected
book opens to reveal its illustration with a soft paper sound. Fast navigation
interrupts the previous preview. OK lifts the selected book from its slot,
enlarges it gently into the reading position, then opens it.
TV Back saves progress and closes the storybook into this catalogue instead
of restarting the previous film. A repeated Back closes only the preview.
Choose the labelled MabelTV action to return deliberately to ordinary TV.

**On this device** opens the same stone-floor catalogue on a
phone or iPad. Tap a book to listen; arrow keys and the page buttons also browse
the collection. Selected books reveal their illustrations with a soft paper
sound, and rapid navigation cancels the preceding preview. The layout adapts
to portrait, landscape and tablet screens.

**Listen on this device** also opens a story directly. Back saves progress,
closes the book and returns it to the device catalogue; it never starts the
previous television programme. Close leaves the catalogue. Audio controls hide
while listening and reappear when paused or when the scene is tapped. Supported
devices receive audio Media Session controls and a full-screen scene button;
Safari may require a **Start story** tap after the opening. Landscape is the
intended view when mirroring the device to another television. The entire book
scene remains in the portal rather than the native audio full-screen player.

Both catalogues stay alphabetical, ignoring a leading **The** or **A**.
Listening progress does not change the order, and refreshes retain the selected
book by identity. Eight matching leather covers give each visible TV slot a
different colour: forest green, sapphire, ruby, amethyst, teal, amber, rose and
brown. The same cover follows a book into reading and back to its slot.

Supported audio includes MP3, M4A/AAC, WAV, FLAC, Ogg, AIFF and Opus. A book may
contain up to 100 chapter files; their originals are retained together in the
resumable upload. Preparation produces stereo AAC for consistent playback.
Total duration, seeking and resume cover the entire book on TV and device;
chapter boundaries do not repeat the opening animation. Images include JPEG, PNG, WebP and
HEIC/HEIF; preparation handles image orientation and retains the whole image.

## Photos & Videos channels

Create a channel, or edit Family Videos, and select **Photos & Videos** under
what plays there. Converting a channel does not delete its existing files.
The channel header's **+** adds photos and videos directly from the phone.
The gallery counts only its memory assets, independently of the old channel's
programme list. Existing channel files are imported only through the explicit
administrative import action, not a button mixed into the gallery.
The authenticated catalogue restores from its revision-scoped device snapshot.
Overlapping refreshes share one request, and transient connection/server errors
get one retry. Unchanged galleries retain decoded images. Thumbnail requests
are limited to four and start near the visible area; unavailable artwork uses
a clean placeholder. Family thumbnails have their own versioned cache keys.

Uploads use the existing resumable transfer queue. If a transfer is interrupted,
choose the same files again to resume. Preparation continues on the Pi after
the upload finishes, with one worker and temperature protection. Failed
preparation can be retried through the existing Activity upload controls.

Tap **Play memories** in the channel header to choose **Play on TV** or
**Play on this device**. **Playback settings** in that same menu chooses a fresh
shuffle or chronological order, a 5–30 second pace, background music and its
volume. Larger compositions stay a little longer. Chronological order
uses embedded media creation timestamps where available, otherwise the source
file timestamp. Upload music from this sheet. Tap a gallery item to start the
memory sequence from that item, preview it on the phone, or remove it from the
gallery with confirmation, including stopping preparation when necessary.
Removing a memory retains its original file.

The presentation varies between large solo portraits, side-by-side pairs,
stacked landscapes and three-item compositions, fitting each whole photo to its frame.
Staggered entrances, gentle movement, sliding transitions and dissolves build
a continuous presentation. Both TV and device use the same composition plan.
Videos play short clips of at most ten seconds, with a companion photo where
available. Longer clips start beyond the opening, while shorter files never
seek beyond their duration. Only one video plays per composition. Portrait and
landscape clips retain their own audio. Background music fades out for
videos and resumes for photos. A new shuffled sequence visits each asset once
before making a new shuffle. Remote pause, previous/next and Back work in this
scene. These channels remain separate from ordinary episode/film playback and
viewing history.

Phone videos are prepared as H.264/AAC, at most 720p and 30 fps; HDR sources
are tone-mapped when their stream metadata identifies HDR. The display scene
itself remains sharp at the native UI resolution. Prepared files and artwork
live under `.family-media/` in the media root, separate from retained originals.

## State, backups and release boundary

Migration 12 adds playlists, queue repeat snapshots, family assets, story
progress and per-channel memory settings to the authoritative SQLite database.
No retired application JSON stores are recreated. Prepared media and originals
are media files; configuration/database backups do not include them. They need
the same separate media protection as ordinary films.

This feature needs a coordinated backend, SQLite and native release. It cannot
be delivered using the portal-only deployer. Installed iOS audio/fullscreen,
phone upload behaviour, physical TV audio, HDMI and remote timing still need
owner acceptance on real devices.
