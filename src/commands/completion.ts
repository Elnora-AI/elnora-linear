// `elnora-linear completion <shell>` — emit shell completion script.
//
// Reads the program's top-level subcommand list at runtime so adding new commands
// in cli.ts automatically extends completion without touching this file.

import type { Command } from "commander";
import { EXIT_CODES } from "../utils/index.js";

export function setupCompletionCommand(program: Command): void {
	const cliName = program.name();

	program
		.command("completion")
		.description("Generate shell completion script")
		.argument("<shell>", "Shell type: bash, zsh, fish, powershell")
		.action((shell: string) => {
			const commands = program.commands.filter((c) => c.name() !== "completion").map((c) => c.name());
			const commandList = commands.join(" ");

			switch (shell) {
				case "bash":
					process.stdout.write(`# ${cliName} bash completion — add to ~/.bashrc
_${cliName.replace(/-/g, "_")}_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${commandList}"
  local global_opts="--help --version"
  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${commands} \${global_opts}" -- "\${cur}") )
  fi
}
complete -F _${cliName.replace(/-/g, "_")}_completions ${cliName}\n`);
					break;
				case "zsh":
					process.stdout.write(`# ${cliName} zsh completion — add to ~/.zshrc
_${cliName.replace(/-/g, "_")}() {
  local commands=(${commands.map((c) => `"${c}"`).join(" ")})
  local global_opts=(--help --version)
  _describe 'command' commands
  _describe 'option' global_opts
}
compdef _${cliName.replace(/-/g, "_")} ${cliName}\n`);
					break;
				case "fish":
					process.stdout.write(`# ${cliName} fish completion — save to ~/.config/fish/completions/${cliName}.fish
${commands.map((c) => `complete -c ${cliName} -n "__fish_use_subcommand" -a "${c}" -d "Manage ${c}"`).join("\n")}
complete -c ${cliName} -l help -d "Show help"
complete -c ${cliName} -l version -d "Show version"\n`);
					break;
				case "powershell":
					process.stdout.write(`# ${cliName} PowerShell completion — add to your $PROFILE
Register-ArgumentCompleter -CommandName ${cliName} -ScriptBlock {
  param($commandName, $wordToComplete, $cursorPosition)
  $commands = @(${commands.map((c) => `'${c}'`).join(", ")})
  $globalOpts = @('--help', '--version')
  $all = $commands + $globalOpts
  $all | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}\n`);
					break;
				default:
					process.stderr.write(
						`${JSON.stringify({ error: `Unknown shell: ${shell}. Supported: bash, zsh, fish, powershell` }, null, 2)}\n`,
					);
					process.exit(EXIT_CODES.VALIDATION);
			}
		});
}
