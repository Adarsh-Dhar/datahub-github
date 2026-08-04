const { Octokit } = require("@octokit/rest");

const MARKER = "<!-- datahub-pr-guardian -->";

function getOctokitClient(config) {
  if (!config.githubToken) throw new Error("GITHUB_TOKEN is required to post a PR comment.");
  return new Octokit({ auth: config.githubToken });
}

// Fetches all PR comments and returns the existing Guardian comment, or null.
// Used by both upsertComment (to decide create vs update) and writebackRunner
// (to parse model risk sections for DataHub writeback).
async function findGuardianComment(config) {
  const octokit = getOctokitClient(config);
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner: config.repoOwner,
    repo: config.repoName,
    issue_number: Number(config.prNumber),
    per_page: 100,
  });
  return comments.find((comment) => comment.body?.includes(MARKER)) || null;
}

async function upsertComment(config, body) {
  if (!config.repoOwner || !config.repoName || !config.prNumber) {
    throw new Error("REPO_OWNER, REPO_NAME, and PR_NUMBER are required to post a PR comment.");
  }

  if (!config.githubToken) {
    console.log("--- PR Guardian Comment (local, no GITHUB_TOKEN) ---");
    console.log(`${MARKER}\n${body}`);
    console.log("--- end ---");
    return { action: "printed-locally", id: null };
  }

  const octokit = getOctokitClient(config);
  const fullBody = `${MARKER}\n${body}`;
  const existing = await findGuardianComment(config);

  if (existing) {
    await octokit.issues.updateComment({
      owner: config.repoOwner,
      repo: config.repoName,
      comment_id: existing.id,
      body: fullBody,
    });
    return { action: "updated", id: existing.id };
  }

  const { data } = await octokit.issues.createComment({
    owner: config.repoOwner,
    repo: config.repoName,
    issue_number: Number(config.prNumber),
    body: fullBody,
  });
  return { action: "created", id: data.id };
}

module.exports = { MARKER, findGuardianComment, upsertComment };
