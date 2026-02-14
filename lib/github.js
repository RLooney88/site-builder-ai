/**
 * GitHub API helpers for file editing and branch management
 */

/**
 * Get the latest commit SHA from a branch
 */
export async function getBranchSHA(repo, token, branch = 'main') {
  const [owner, repoName] = repo.split('/');
  
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${branch}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to get ${branch} branch SHA: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.object.sha;
}

/**
 * Get the latest commit SHA from main branch (legacy alias)
 */
export async function getMainBranchSHA(repo, token) {
  return getBranchSHA(repo, token, 'main');
}

/**
 * Create a new branch from main
 */
export async function createBranch(repo, token, branchName) {
  const [owner, repoName] = repo.split('/');
  
  // Get main branch SHA
  const mainSHA = await getMainBranchSHA(repo, token);
  
  // Create new branch
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/git/refs`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: mainSHA
      })
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create branch: ${error.message}`);
  }
  
  return await response.json();
}

/**
 * Get file content from GitHub
 */
export async function getFileContent(repo, token, filePath, branch = 'main') {
  const [owner, repoName] = repo.split('/');
  
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}?ref=${branch}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to get file: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Decode base64 content
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  
  return {
    content,
    sha: data.sha // Needed for updates
  };
}

/**
 * Update or create a file on GitHub
 * Defaults to staging branch for preview workflow
 */
export async function updateFile(repo, token, filePath, content, message, branch = 'staging', fileSHA = null) {
  const [owner, repoName] = repo.split('/');
  
  // Encode content as base64
  const encodedContent = Buffer.from(content).toString('base64');
  
  const body = {
    message,
    content: encodedContent,
    branch
  };
  
  // If updating existing file, include SHA
  if (fileSHA) {
    body.sha = fileSHA;
  }
  
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update file: ${error.message}`);
  }
  
  return await response.json();
}

/**
 * Generate Vercel preview URL for staging branch
 */
export function getStagingPreviewURL(vercelProject, githubUsername) {
  // Vercel preview URL pattern for staging: https://{project}-git-staging-{username}.vercel.app
  return `https://${vercelProject}-git-staging-${githubUsername}.vercel.app`;
}

/**
 * Generate Vercel preview URL from branch name (legacy)
 */
export function getVercelPreviewURL(vercelProject, branchName = 'staging', teamSlug = null) {
  // Vercel preview URL pattern: https://{project}-git-{branch}-{team}.vercel.app
  // If no team, omit the team part
  
  // Sanitize branch name for URL (replace special chars with hyphens)
  const sanitizedBranch = branchName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  
  if (teamSlug) {
    return `https://${vercelProject}-git-${sanitizedBranch}-${teamSlug}.vercel.app`;
  }
  
  // Personal account - Vercel uses username from GitHub
  return `https://${vercelProject}-git-${sanitizedBranch}.vercel.app`;
}

/**
 * Delete a preview branch (cleanup)
 */
export async function deleteBranch(repo, token, branchName) {
  const [owner, repoName] = repo.split('/');
  
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${branchName}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );
  
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete branch: ${response.statusText}`);
  }
  
  return true;
}

/**
 * Merge staging to main (publish changes)
 */
export async function publishToProduction(repo, token, message = 'Publish changes from staging to production') {
  const [owner, repoName] = repo.split('/');
  
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/merges`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        base: 'main',
        head: 'staging',
        commit_message: message
      })
    }
  );
  
  // 204 = nothing to merge (branches already in sync), 201 = merge created
  if (response.status === 204) {
    return { status: 'up-to-date', message: 'Staging and production are already in sync' };
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to publish to production: ${error.message}`);
  }
  
  return await response.json();
}

/**
 * Merge preview branch to main (legacy - use publishToProduction instead)
 */
export async function mergeBranch(repo, token, branchName = 'staging', message = 'Merge preview changes to production') {
  return publishToProduction(repo, token, message);
}
