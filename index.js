import { execSync } from "child_process";
import fetch from "node-fetch";
import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import gitBranch from "git-branch";

//Initial state
let initialState = {
  arguments: extractCommandArguments(process.argv),
  stateFilePath: path.resolve(process.argv[1].slice(0, -8), "user_state.json"),
};

try {
  await main();
} catch (e) {
  console.log(chalk.red("[ERROR]: " + e.message));
  console.log("[INFO]:Try to run again the script with option '-r'");
}

async function main() {
  // delete `user_state` file if there is the `-r` argument
  if (initialState.arguments.delete) {
    await deleteFile(initialState.stateFilePath);
  }

  const fileData = parseFileState(initialState.stateFilePath);
  //State after reading the file
  let state = {
    ...initialState,
    ...fileData,
    jiraSearchQuery: `search?jql=project=${fileData?.project} AND key = `,
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
      state.stateFilePath,
      JSON.stringify({
        apiKey: state?.apiKey,
        project: state?.project,
        jiraApiUrl: state.jiraApiUrl,
      })
    );
  }

  const branch = await getBranchName();
  const issue = extractIssue(branch, state.project);

  if (!issue) {
    console.log(
      chalk.red("ERROR") +
        " : Couldn't find any jira issue related with branch: " +
        chalk.yellow(branch)
    );
    return;
  }

  // create the full api url
  const apiFullUrl = `${state.jiraApiUrl}/${state.jiraSearchQuery}${issue}`;

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
    const data = await response.json();
    if (data?.issues?.length >= 1) {
      const issue = data?.issues[0];
      const summary = issue?.fields?.summary;
      const key = issue?.key;
      const name = issue?.fields?.components[0]?.name;
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
    console.error("Error retrieving branch name:", error);
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

  if (!project) {
    state.project = await getInputFromUser(`Provide Project : `);
    state.jiraSearchQuery = `search?jql=project=${state.project} AND key = `;
    if (!state.project?.trim()) {
      console.log(chalk.red("INVALID Project"));
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
