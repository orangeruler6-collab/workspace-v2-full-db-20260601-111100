Slim migration package based on workspace-v2-migration-20260519-150107.
Created: 2026-05-19 15:25:33

Difference from full package:
- Removed public/uploads/douyin/*.mp4 and *.mp3 cache files.
- Kept code, .env, databases, transcripts/text/json metadata, imagegen files, docs, scripts, and uploads outside the Douyin media cache.

Use full package if you need historical downloaded Douyin media files to remain playable from old local public URLs.
Use this slim package if media has already moved to backend/server storage or can be re-fetched.
