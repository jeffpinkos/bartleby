if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error(
    `Bartleby requires Node.js 24; this command is using Node.js ${process.versions.node}. Run "nvm use" in the project directory, then try again.`,
  );
  process.exitCode = 1;
}
