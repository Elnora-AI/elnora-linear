# Scheduling the curator

`elnora-linear curator-run` is a single command. To run it on a recurring schedule, point your OS scheduler at it. The curator is idempotent — it locks its state file, so two concurrent runs cannot corrupt each other.

All examples below assume `elnora-linear` is on `PATH` (`npm install -g @elnora-ai/linear`) and that `LINEAR_API_KEY` is in `~/.config/elnora-linear/.env`. If you also want the LLM rule engine, set `ANTHROPIC_API_KEY` in the same file or the scheduler's environment.

## macOS — launchd

Save as `~/Library/LaunchAgents/com.elnora-linear.curator.plist`, then `launchctl load ~/Library/LaunchAgents/com.elnora-linear.curator.plist`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.elnora-linear.curator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-lc</string>
        <string>elnora-linear curator-run --output text</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
        <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
    </array>
    <key>StandardOutPath</key>
    <string>/tmp/elnora-linear-curator.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/elnora-linear-curator.err.log</string>
</dict>
</plist>
```

Edit `Hour` / `Minute` to fit your day. To unload: `launchctl unload ~/Library/LaunchAgents/com.elnora-linear.curator.plist`.

## Linux — systemd timer

Save the unit and timer to `~/.config/systemd/user/`, then `systemctl --user enable --now elnora-linear-curator.timer`.

`elnora-linear-curator.service`:

```ini
[Unit]
Description=Linear curator — validate Linear issues against external signals

[Service]
Type=oneshot
ExecStart=/usr/bin/env elnora-linear curator-run --output text
EnvironmentFile=%h/.config/elnora-linear/.env
```

`elnora-linear-curator.timer`:

```ini
[Unit]
Description=Run the Linear curator weekday mornings

[Timer]
OnCalendar=Mon..Fri 09:30
Persistent=true

[Install]
WantedBy=timers.target
```

Check status: `systemctl --user status elnora-linear-curator.timer`. Inspect logs: `journalctl --user -u elnora-linear-curator.service`.

## Windows — Task Scheduler

PowerShell, run once:

```powershell
$action  = New-ScheduledTaskAction -Execute 'elnora-linear' -Argument 'curator-run --output text'
$trigger = New-ScheduledTaskTrigger -Daily -At 9:30am -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName 'ElnoraLinearCurator' -Action $action -Trigger $trigger -Principal $principal
```

To remove: `Unregister-ScheduledTask -TaskName 'ElnoraLinearCurator' -Confirm:$false`.

## Recommended cadence

The curator is cheap when used with `--collect-only` and meaningful when used with the LLM rule engine. A common pattern:

- **Morning catch-up** — weekdays 09:30, full pipeline. The curator proposes state changes for issues whose external signals (PR merged, commits landed, related issue closed) have moved on without the Linear state catching up.
- **Midday re-check** — weekdays 14:00, `--collect-only`. Cheap signal refresh so the morning state file doesn't drift.

You don't have to run both. One scheduled invocation is enough for most workspaces.

## Manual run

```sh
elnora-linear curator-run --dry-run --output text   # preview without writes
elnora-linear curator-run                            # actually apply HIGH actions
elnora-linear curator-run --source github-prs        # restrict to one signal source
```

## Slack bridge

The curator stages MEDIUM-tier questions in `curator-state.json` but does not post to Slack — `bridges/slack/bridge.py` is the consumer that DMs assignees and applies their replies back to Linear. See `bridges/slack/README.md` for setup; this section covers scheduling it alongside the curator.

**The bridge must run after the curator on every tick.** A curator run that stages new MEDIUM questions is wasted work until the bridge picks them up. Schedule both, with the bridge 2–5 minutes behind the curator, and add one or two later ticks the same day to poll for replies.

### macOS — launchd

A ready-to-edit template ships at `bridges/slack/launchd.example.plist` (path: `$(npm root -g)/@elnora-ai/linear/bridges/slack/launchd.example.plist`). Substitute every `{{REPO_ROOT}}` placeholder, drop into `~/Library/LaunchAgents/`, and bootstrap:

> **Python interpreter:** the template uses `/usr/bin/python3`. That's correct only if you installed `slack-sdk` and `anthropic` against the system Python. If you installed them into a virtualenv (a common PEP 668 workaround), swap that string for the venv's interpreter, e.g. `~/.local/share/elnora-bridge/bin/python` — otherwise launchd will fire the bridge and it'll exit with `ModuleNotFoundError: slack_sdk`. `pipx`-installed deps generally need no plist edit because `pipx` exposes its environment to system Python.

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.linear-curator-bridge.plist
```

The template fires `tick` mode at 09:38, 11:30, and 14:30 on weekdays — 8 minutes after the curator example above, then twice more for replies. Adjust `StartCalendarInterval` to match your curator cadence. Note: launchd does not source `.envrc` / `.env` / shell rc files; either set `SLACK_BOT_TOKEN` and `ANTHROPIC_API_KEY` in the plist's `EnvironmentVariables` dict (mind plist file perms) or wrap the python call in a script that loads your secret store before `exec`-ing `bridge.py`.

### Linux — systemd timer

Reuse the curator's pattern. `elnora-linear-bridge.service`:

```ini
[Unit]
Description=Linear curator Slack bridge — DM assignees with MEDIUM-tier questions
After=elnora-linear-curator.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -u %h/.local/lib/elnora-linear/bridges/slack/bridge.py tick
EnvironmentFile=%h/.config/elnora-linear/.env
```

`elnora-linear-bridge.timer`:

```ini
[Unit]
Description=Run the Linear Slack bridge after the curator + twice more for replies

[Timer]
OnCalendar=Mon..Fri 09:35
OnCalendar=Mon..Fri 11:30
OnCalendar=Mon..Fri 14:30
Persistent=true

[Install]
WantedBy=timers.target
```

Adjust the `bridge.py` path to wherever you cloned or installed the package (`$(npm root -g)/@elnora-ai/linear/bridges/slack/bridge.py` for a global npm install). Enable: `systemctl --user enable --now elnora-linear-bridge.timer`.

### Linux — cron

```cron
30 9 * * 1-5  elnora-linear curator-run --output text
35 9 * * 1-5  python3 /path/to/bridges/slack/bridge.py tick
30 11 * * 1-5 python3 /path/to/bridges/slack/bridge.py tick
30 14 * * 1-5 python3 /path/to/bridges/slack/bridge.py tick
```

### Manual run

```sh
python3 bridges/slack/bridge.py tick --dry-run --verbose   # smoke test, no posts
python3 bridges/slack/bridge.py tick                        # post new MEDIUM questions + poll replies
python3 bridges/slack/bridge.py post-pending                # only post; skip reply polling
python3 bridges/slack/bridge.py resolve                     # only poll replies
```

The bridge takes the same exclusive file lock as the curator on `curator-state.json`, so concurrent runs cannot race. Exit code 4 means the curator is still running — wait and retry.
