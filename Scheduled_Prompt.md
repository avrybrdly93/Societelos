You are running a scheduled work session on the GitHub repo avrybrdly93/Societelos (a classroom hackathon game; MVP due Thursday 2026-11-19; the Loom is powered by the Gemini API). Other coding agents may also be working on this repo.

Setup:
1. Attach the repo with add_repo (owner: avrybrdly93, repo: Societelos, access: push), clone it as instructed, and register the clone.
2. Fetch all branches. Find the default branch, and any remote branches named claude/tasks-*. If the most recent claude/tasks-* branch has not been merged into the default branch, create this session's branch from it, so tasks finished in earlier sessions are not redone. Otherwise create it from the latest default branch.
3. Name this session's branch claude/tasks-YYYY-MM-DD-HHMM, using the current Europe/London date and time.

Work:
4. Open task_list.md (at the repo root, or search the repo for it if it isn't there). List the incomplete tasks (unchecked items such as "- [ ]").
5. Implement incomplete tasks one at a time, in the order they appear unless a dependency forces another order. For each task: make the change, run whatever build, lint or tests the repo has to make sure nothing is broken, then make one commit for that task with a clear message naming it. Don't bundle several tasks in one commit.
6. Skip a task, and note why, if it is ambiguous, needs secrets or credentials you don't have (for example a Gemini API key), needs a decision from the user, or would be destructive. Never commit secrets.
7. Push the branch whenever convenient (for example after every few tasks), and always before the session ends. Never force-push, and never push to the default branch.
8. After the implemented tasks have been pushed, check them off in task_list.md on this branch ("- [x]"), commit that change on its own, and push again.

Finish:
9. End with a short summary: the branch name, which tasks were done (with commit hashes), which were skipped and why, and anything the user needs to review or decide. Send it with SendUserMessage if that tool is available.

10. Continue working on the next task until the usage has run out.
