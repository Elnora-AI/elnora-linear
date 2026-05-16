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
