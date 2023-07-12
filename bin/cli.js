#!/usr/bin/env node

import { execSync } from "child_process";
import fetch from "node-fetch";
import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import gitBranch from "git-branch";
import os from "os";

//Initial state
const configFolderPath = createConfigurationPath();
let initialState = {
  arguments: extractCommandArguments(process.argv),
  configFilePath: path.join(configFolderPath, "config.json"),
};

try {
  await main();
} catch (e) {
  console.log(chalk.red("[ERROR]: " + e.message));
  // if (!(e.message?.includes("re-authenticate") || e.message?.includes("git"))) {
  //   console.log("[INFO]:Try to run again the script with option '-r'");
  // }
}

async function main() {
  // Create Folder in order to keep user's configuration
  createFolderIfNotExists(configFolderPath);

  // delete `user_state` file if there is the `-r` argument
  if (initialState.arguments?.delete) {
    await deleteFile(initialState.configFilePath);
  }

  const fileData = parseFileState(initialState.configFilePath);
  //State after reading the file
  let state = {
    ...initialState,
    ...fileData,
  };

  // Check for user inputs
  const userInputs = await checkForUserInput(state);
  if (userInputs) {
    state = {
      ...state,
      ...userInputs,
    };

    // Write user state in the folder f
    writeToFolder(
      state.configFilePath,
      JSON.stringify({
        apiKey: state?.apiKey,
        jiraApiUrl: state.jiraApiUrl,
      })
    );
  }

  const { project, issue } = await extractJiraProjectIssueName();

  if (!issue) {
    console.log(
      chalk.red("ERROR") +
        " : Couldn't find any jira issue related to the project: " +
        chalk.yellow(project)
    );
    return;
  }

  // create the full api url
  const apiFullUrl = `${state.jiraApiUrl}/search?jql=project=${project} AND key = ${issue}`;

  // make the request and retrieve the commit message
  let commitMessage = await generateCommitMessage(apiFullUrl, state.apiKey);

  // add additional commit message if the user has provided from the `-m` argument
  commitMessage = appendCommitMessageFromArguments(
    commitMessage,
    state?.arguments?.commitMessage
  );

  // ask user to verify the commit message before submitting it
  commitMessageVerification(commitMessage);

  //END
}

// Functions
async function generateCommitMessage(apiUrl, apiKey) {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (response.headers.get("Content-Type")?.includes("html")) {
      throw new Error(
        "Something went wrong, Maybe you need to re-authenticate with your jira provider..."
      );
    }
    const data = await response.json();
    if (data?.issues?.length >= 1) {
      const issue = data?.issues[0];
      const summary = issue?.fields?.summary;
      const key = issue?.key;
      let name = issue?.fields?.components[0]?.name;
      name = name?.split(" ")?.join("-");

      if (!summary) {
        throw new Error("Summary is missing...");
      }
      if (!key) {
        throw new Error("Ticket number is missing...");
      }
      if (!name) {
        throw new Error("Project is missing...");
      }
      return `[${name}][${key}]: ${summary?.trim()}`;
    }
    throw new Error("No issues found");
  } catch (e) {
    throw e;
  }
}

function parseFileState(path) {
  try {
    const fileContent = fs.readFileSync(path, "utf8");
    return JSON.parse(fileContent);
  } catch (e) {
    return null;
  }
}

async function getInputFromUser(message) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.yellow(message), (input) => {
      rl.close();
      resolve(input?.trim());
    });
  });
}

function writeToFolder(path, content) {
  fs.writeFileSync(path, content, "utf8", (err) => {
    if (err) {
      console.error(err);
    }
  });
}

function commitMessageVerification(commitMsg) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Ask the user to validate the commit message
  rl.question(
    chalk.yellowBright(`Commit message: `) +
      `${commitMsg}` +
      chalk.yellow(`\nSubmit your commit? (Y/N) `),
    (answer) => {
      rl.close();

      if (answer.toLowerCase() === "y") {
        try {
          execSync(`git commit -m "${commitMsg}"`, { stdio: "inherit" });
        } catch (e) {}
      } else {
        console.log(chalk.red("EXIT without commit"));
      }
    }
  );
}

async function getBranchName() {
  try {
    return await gitBranch();
  } catch (error) {
    if (error?.message?.includes(".git/HEAD does not exist")) {
      throw new Error("The command should run inside a git repository");
    }
    throw new Error("Error retrieving branch name");
  }
}

function extractIssue(branch, project) {
  const regex = new RegExp(`${project}-\\d{1,4}`);
  const matches = branch.match(regex);
  if (matches?.length > 0) {
    return matches[0];
  }
}

function extractCommandArguments(args) {
  return args.slice(2).reduce((acc, arg) => {
    if (arg?.startsWith("-m")) {
      acc = { ...acc, commitMessage: arg.slice(2) };
    }
    if (arg?.startsWith("-r")) {
      acc = { ...acc, delete: true };
    }
    if (arg?.startsWith("-i")) {
      acc = { ...acc, issue: arg.slice(2) };
    }
    return acc;
  }, {});
}

function deleteFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
      if (err) {
        if (err?.code === "ENOENT") {
          resolve(true);
        } else {
          reject(false);
        }
      } else {
        resolve(true);
      }
    });
  });
}

function appendCommitMessageFromArguments(commitMessage, argumentsMessage) {
  return argumentsMessage
    ? `${commitMessage} - ${argumentsMessage}`
    : commitMessage;
}

async function checkForUserInput({ apiKey, project, jiraApiUrl }) {
  const state = {};
  if (!apiKey) {
    state.apiKey = await getInputFromUser(`Provide API_KEY : `);
    if (!state.apiKey?.trim()) {
      console.log(chalk.red("INVALID API_KEY"));
      return;
    }
  }

  if (!jiraApiUrl) {
    state.jiraApiUrl = await getInputFromUser(`Provide API URL : `);
    if (!state.jiraApiUrl?.trim()) {
      console.log(chalk.red("INVALID URL"));
      return;
    }
  }

  return Object.keys(state)?.length > 0 ? state : null;
}

function createConfigurationPath() {
  const folderName = "FastJiraCommit";
  return os.platform() === "win32"
    ? path.join(process.env.APPDATA, folderName)
    : path.join(os.homedir(), folderName);
}

function createFolderIfNotExists(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
  }
}

function extractProject(branch) {
  const projectIssue = branch?.split("-")?.[0];
  return projectIssue?.includes("/")
    ? projectIssue?.split("/")[1]
    : projectIssue;
}

async function extractJiraProjectIssueName() {
  //From argument -i
  if (initialState?.arguments?.issue) {
    const project = extractProject(initialState?.arguments?.issue);
    if (!project) {
      throw new Error("Couldn't extract project");
    }
    return {
      project,
      issue: extractIssue(initialState?.arguments?.issue, project),
    };
  }

  // From branch
  const branch = await getBranchName();
  const project = extractProject(branch);
  if (!project) {
    throw new Error("Couldn't extract project from branch");
  }

  return {
    project: extractProject(branch),
    issue: extractIssue(branch, project),
  };
}
