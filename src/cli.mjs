import { fail } from "./errors.mjs";
import { PROVIDERS } from "./session.mjs";

const HELP = { names: ["--help", "-h"], description: "Show this help." };
const COMMANDS = {
  configure: {
    description: "Initialize or show configuration, or select an adapter.",
    options: [
      { name: "--adapter", value: "name", description: "Select local, or register a host with --module." },
      { name: "--module", value: "absolute-path", description: "Host adapter module; requires --adapter." },
    ],
    notes: "No options initializes missing configuration or shows existing settings.\nUse --adapter local for local selection; host registration requires both options.",
    example: "session-marking configure --adapter local",
  },
  describe: {
    description: "Show shared target fields and configured host requirements.",
    options: [
      { name: "--adapter", value: "name", description: "Assert the configured adapter name." },
    ],
    notes: "Shows core input fields with any host requirements. No current-session identity is required.",
    example: "session-marking describe",
  },
  mark: {
    description: "Mark a provider session for a selected target.",
    options: [
      { name: "--adapter", value: "name", description: "Assert the configured adapter name." },
      { name: "--selection-json", value: "json-object", required: true, description: "Target fields returned by describe." },
      { name: "--description", value: "text", allowEmpty: true, description: "Save a session note; retries retain the first description." },
      { name: "--provider", value: PROVIDERS.join("|"), description: "Provider for an explicit session; requires --session-id." },
      { name: "--session-id", value: "id", description: "Explicit session ID; requires --provider." },
    ],
    notes: "Omit both identity options to use the current Codex or Claude Code session.\nUse --provider and --session-id together to select a specific session.\nRun session-marking describe for shared fields and host requirements. Writes to configured destinations.",
    example: "session-marking mark --selection-json '{\"project\":\"website\",\"task\":\"fix-login\"}'",
  },
  list: {
    description: "List saved local session bindings as JSON.",
    options: [
      { name: "--filter", value: "field.path=value", repeatable: true, description: "Exact scalar text match; repeat to require all matches." },
      { name: "--sort", value: "field.path", description: "Sort scalar text alphabetically, ascending by default." },
      { name: "--order", value: "asc|desc", description: "Override the default or explicit sort direction." },
    ],
    notes: "Defaults to markedAt descending (newest first). Missing values sort last.\nReads the configured local store, including when local writes are disabled.\nNo host access or current-session identity is required.",
    example: "session-marking list --filter target.project=website --sort markedAt",
  },
};

function optionLabel(option) {
  return `${option.name} <${option.value}>`;
}

export function commandUsage(command) {
  if (!command) return `Usage: session-marking <${Object.keys(COMMANDS).join("|")}> [options]`;
  const options = COMMANDS[command].options.map((option) => {
    const label = optionLabel(option);
    return `${option.required ? label : `[${label}]`}${option.repeatable ? "..." : ""}`;
  });
  return `Usage: session-marking ${command} ${options.join(" ")} [${HELP.names[0]}]`;
}

export function parseArguments(argv) {
  const command = argv[0];
  if (argv.length === 0 || (HELP.names.includes(command) && argv.length === 1)) return { command: null, values: {}, help: true };
  if (!Object.hasOwn(COMMANDS, command)) fail("ARGUMENT_INVALID", commandUsage());
  const definition = COMMANDS[command];
  const values = {};
  let help = false;
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (HELP.names.includes(key)) {
      if (help) fail("ARGUMENT_INVALID", "The session-marking arguments are invalid.");
      help = true;
      continue;
    }
    const option = definition.options.find((candidate) => candidate.name === key);
    const value = argv[++index];
    if (!option || (!value && !(option.allowEmpty && value === "")) || value.startsWith("--") || (Object.hasOwn(values, key) && !option.repeatable)) {
      fail("ARGUMENT_INVALID", "The session-marking arguments are invalid.");
    }
    if (option.repeatable) (values[key] ??= []).push(value);
    else values[key] = value;
  }
  if (!help && definition.options.some((option) => option.required && !Object.hasOwn(values, option.name))) {
    fail("ARGUMENT_INVALID", commandUsage(command));
  }
  return { command, values, help };
}

export function renderHelp(command) {
  const definition = command ? COMMANDS[command] : null;
  const rows = definition
    ? definition.options.map((option) => [optionLabel(option), option.description])
    : Object.entries(COMMANDS).map(([name, value]) => [name, value.description]);
  if (definition) rows.push([HELP.names.join(", "), HELP.description]);
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, description]) => `  ${label.padEnd(width)}  ${description}`);
  const globalOptions = definition ? "" : `\n\nOptions:\n  ${HELP.names.join(", ")}  ${HELP.description}`;
  const introduction = definition?.description ?? "Save and inspect session bindings.";
  const detail = definition
    ? `${definition.notes}\n\nExamples:\n  ${definition.example}`
    : "Use session-marking <command> --help for options and an example.\nCommands return JSON; help returns text. Errors return JSON on stderr.";
  return `${introduction}\n\n${commandUsage(command)}\n\n${definition ? "Options" : "Commands"}:\n${lines.join("\n")}${globalOptions}\n\n${detail}`;
}
