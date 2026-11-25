# A Model is a checkpoint, not a family

Each `modelId` identifies one released checkpoint; a provider shipping a new snapshot adds a new Model rather than overwriting earlier results. Corrections to the same checkpoint replace the score in place and are preserved in Git history. This keeps published results comparable across evaluation settings and prevents a provider's version bump from silently rewriting historical leaderboard entries.
