# @dp/jira-commit

This package makes your `git commit` faster by providing the `commit message` in case you use Jira.
The pattern of the commit message is: `[JIRA_PROJECT_NAME][JIRA_ISSUE]: [JIRA_SUMMARY]`.

> > The prerequisite for this to work is that the branch name should include a valid Jira issue number.

## Installation

npm i -g @dp/jira-commit

## How to use

1. Run it directly from node_modules
   `node {node_modules_file_path}/@dp/jira-commit/index.js`

OR

2. Create an alias
   `alias jc='node {node_modules_file_path}/@dp/jira-commit/index.js'`

### Provide additional commit message
You can provide an additional commit message. This message will be appended to the one provided by the library.

Run `jc -m"additional message..."`

### Reset the configuration

Run `jc -r` in order to reset the configuration. You will be asked again to fill the configuration.

## Configuration

When you execute the script for the first time, you will be asked to configure the below:

1. `Provide API_KEY` - This is the API key for Jira. - Go to Your JIRA profile -> Personal Access Tokens -> Create new token.
2. `Provide Project` - This is the project from which you want to get the Jira issue.
3. `Provide API URL` - This is the REST API URL of Jira. It should be like `{JIRA_URL}/rest/api/2`
