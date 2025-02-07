const { Toolkit } = require('actions-toolkit')
const getConfig = require('./utils/config')

const CONFIG_FILENAME = 'pr-lint.yml'

const defaults = {
  projects: ['PROJ'],
  keywords: [],
  check_title: true,
  check_branch: false,
  check_commits: false,
  ignore_case: false
}

Toolkit.run(
  async tools => {
    const { repository, pull_request } = tools.context.payload

    const repoInfo = {
      owner: repository.owner.login,
      repo: repository.name,
      ref: pull_request.head.ref
    }

    const config = {
      ...defaults,
      ...(await getConfig(tools.github, CONFIG_FILENAME, repoInfo))
    }

    const title = config.ignore_case ?
      pull_request.title.toLowerCase() :
      pull_request.title

    const head_branch = config.ignore_case ?
      pull_request.head.ref.toLowerCase() :
      pull_request.head.ref

      const projects = config.projects.map(project => config.ignore_case ? project.toLowerCase() : project)
      const keywords = config.keywords.map(keywords => config.ignore_case ? keywords.toLowerCase() : keywords)
    const title_passed = (() => {
      if (config.check_title) {
        // check the PR title matches PROJECT-1234 somewhere
        const isProjectMatch = projects.some(project => title.match(createProjectRegex(project)))
        const isKeywordMatch = keywords.some(keyword => title.includes(keyword))
        if (!isProjectMatch && !isKeywordMatch) {
          tools.log('PR title ' + title + ' does not contain approved project')
          return false
        }
      }
      return true
    })()

    const branch_passed = (() => {
      // check the branch matches PROJECT-1234 or PROJECT_1234 somewhere
      if (config.check_branch) {
        const isProjectMatch = projects.some(project => head_branch.match(createProjectRegex(project)))
        const isKeywordMatch = keywords.some(keyword => head_branch.includes(keyword))
        if (!isProjectMatch && !isKeywordMatch) {
          tools.log('PR branch ' + head_branch + ' does not contain an approved project')
          return false
        }
      }
      return true
    })()

    const commits_passed = await (async () => {
      // check the branch matches PROJECT-1234 or PROJECT_1234 somewhere
      if (config.check_commits) {
        const listCommitsParams = {
          owner: repository.owner.login,
          repo: repository.name,
          pull_number: pull_request.number
        }
        const commitsInPR = (await tools.github.pulls.listCommits(listCommitsParams)).data
        const failedCommits = findFailedCommits(projects, keywords, commitsInPR, config.ignore_case);

        if(failedCommits.length) {
          failedCommits.forEach(
            failedCommit => tools.log('Commit message \'' + failedCommit + '\' does not contain an approved project')
          )
          return false
        }
      }
      return true
    })()

    const statuses = [title_passed, branch_passed, commits_passed]

    if (statuses.some(status => status === false )){
      tools.exit.failure("PR Linting Failed")
    } else {
      tools.exit.success()
    }
  },
  { event: ['pull_request.opened', 'pull_request.edited', 'pull_request.synchronize', 'pull_request.ready_for_review'], secrets: ['GITHUB_TOKEN'] }
)

function findFailedCommits(projects, keywords, commitsInPR, ignoreCase) {
  const failedCommits = [];
  commitsInPR.forEach(commit => {
    const commitMessage = ignoreCase ? commit.commit.message.toLowerCase() : commit.commit.message

    for (const project of projects) {
      const isProjectMatch = commitMessage.match(createProjectRegex(project))
      
      if (isProjectMatch) {
        return;
      }
    }

    for (const keyword of keywords) {
      const isKeywordMatch = commitMessage.includes(keyword)
      
      if (isKeywordMatch) {
        return;
      }
    }

    failedCommits.push(commit)
  });
  return failedCommits;
}

function createProjectRegex(project) {
  return new RegExp(project + '[-_]\\d*')
}
