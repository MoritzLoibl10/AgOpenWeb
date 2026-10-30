; AgOpenWeb
; Copyright (C) 2024-2026 AgOpenWeb Contributors
; SPDX-License-Identifier: Apache-2.0

; Windows installer for customers (fork, feature/installer), built with Inno Setup 6 from the
; launcher bundle that deploy/windows/package.sh publishes (the folder, unzipped).
;
;   ISCC.exe /DAppVersion=26.7.0-moritz.25 /DFileVersion=26.7.0.25 /DSourceDir=<bundle folder> ^
;            /DOutDir=<output folder> [/DWebView2Setup=<MicrosoftEdgeWebview2Setup.exe>] ^
;            deploy\windows\installer.iss
;
; - Installs for the current user (no administrator needed) into %LOCALAPPDATA%\Programs\<name>;
;   an administrator may choose "for all users" in the first dialog.
; - Start menu entry, optional desktop shortcut, entry in "Apps" for uninstalling.
; - An update installs over the old version (same AppId); the app is closed first if it runs.
; - Data is never touched, neither by an update nor by uninstalling: fields, profiles, work log and
;   settings live in Documents\AgOpenWeb (AppDataRoot), the web view's storage in
;   %LOCALAPPDATA%\Photino. This script installs and removes only the program folder.
; - The port stays 5174: the app has it built in; the installer neither asks for nor sets one.
; - Windows Firewall (task "firewall", on by default): two inbound rules for this program only, on
;   the ports the host listens on: UDP 9999 (modules, UdpCommunicationService.ModulePort), UDP 2211
;   and 2222 (GPS receivers, Gps1Port/Gps2Port) and TCP 5174 (web UI for tablets on the LAN,
;   RemoteServerHost.Port); from the local subnet, every profile (profile=any: domain, private and
;   public; the network to the module is usually "unidentified", i.e. public). Creating them needs administrator
;   rights: Windows asks once (UAC) while installing; uninstalling removes them the same way. An
;   update deletes and recreates them, so a moved program folder never leaves a stale rule.
; - WebView2 runtime: checked in the registry; if missing, Microsoft's bootstrapper (passed in as
;   /DWebView2Setup, downloaded by the workflow) installs it. Built without it, the setup only
;   says that the runtime is missing.
; - Autostart (task "autostart", on by default): starts with Windows for the user who installs,
;   fullscreen (--autostart); HKCU Run entry, removed on uninstall or when the task is unticked.
;   A second start brings the running window to the front (Program.cs, SingleInstance).
; - Not signed (see docs/Installer.md): Windows SmartScreen warns until the setup is signed.

; Product name: everything the user sees (setup, Start menu, shortcut, "Apps", firewall rules).
; The program inside keeps its AgOpenWeb names (AgOpenWeb.Desktop.exe, Documents\AgOpenWeb).
#ifndef AppName
  #define AppName "LM Steering Solutions"
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef FileVersion
  #define FileVersion "0.0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\agopenweb-win-x64"
#endif
#ifndef OutDir
  #define OutDir "..\..\dist"
#endif
#define AppExe "AgOpenWeb.Desktop.exe"
; Names of the two firewall rules; the uninstaller deletes exactly these. The test versions up
; to 26.7.0-moritz.26 were named AgOpenWeb: their rules (FwOld*) are removed too.
#define FwUdp AppName + " Module (UDP)"
#define FwTcp AppName + " Tablets (TCP)"
#define FwOldUdp "AgOpenWeb Module (UDP)"
#define FwOldTcp "AgOpenWeb Tablets (TCP)"

[Setup]
; FINAL (October 2026, with the product name): Windows recognises an update by this id. Never
; change it, not even with a new name, or later updates install beside the old version.
AppId={{6C0E8A52-5D7B-4C1E-9A2F-3B8D41E7C905}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
VersionInfoVersion={#FileVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; The Start menu folder follows the product name also on an update of an AgOpenWeb test version.
UsePreviousGroup=no
; Fixed folder (no choice): an update empties the program folder first, which must never be a
; folder the user picked for something else.
DisableDirPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
; No spaces in the file name (GitHub would turn them into dots): LM-Steering-Solutions-Setup-….exe
OutputBaseFilename={#StringChange(AppName, " ", "-")}-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
LicenseFile=..\..\LICENSE.md

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
de.AutostartGroup=Start:
de.AutostartTask=Beim Windows-Start automatisch starten (im Vollbild, nur für diesen Benutzer)
en.AutostartGroup=Start:
en.AutostartTask=Start automatically with Windows (fullscreen, this user only)
de.FirewallGroup=Netzwerk:
de.FirewallTask=Windows-Firewall nur für dieses Programm freigeben: Module (UDP 9999, 2211, 2222) und Tablets im Netz (TCP 5174). Windows fragt dafür einmal nach Administratorrechten. Ohne Freigabe fragt Windows beim ersten Start selbst.
de.FirewallRun=Windows-Firewall-Freigabe für {#AppName} einrichten …
de.WebView2Run=Microsoft-WebView2-Laufzeit installieren …
de.WebView2Missing=Die Microsoft-WebView2-Laufzeit fehlt, und dieses Setup enthält sie nicht. Ohne sie bleibt das Programmfenster leer. Bitte von https://go.microsoft.com/fwlink/p/?LinkId=2124703 installieren.
en.FirewallGroup=Network:
en.FirewallTask=Allow only this program through Windows Firewall: modules (UDP 9999, 2211, 2222) and tablets on the network (TCP 5174). Windows asks once for administrator rights. Without it, Windows asks itself on first start.
en.FirewallRun=Setting up the Windows Firewall rule for {#AppName} …
en.WebView2Run=Installing the Microsoft WebView2 runtime …
en.WebView2Missing=The Microsoft WebView2 runtime is missing and this setup does not include it. Without it the program window stays empty. Please install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "{cm:AutostartTask}"; GroupDescription: "{cm:AutostartGroup}"
Name: "firewall"; Description: "{cm:FirewallTask}"; GroupDescription: "{cm:FirewallGroup}"

[Registry]
; Autostart for the current user only (HKCU), fullscreen. Removed on uninstall; an update with the
; box unticked removes it too.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExe}"" --autostart"; Flags: uninsdeletevalue; Tasks: autostart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "{#AppName}"; ValueType: none; Flags: deletevalue dontcreatekey; Tasks: not autostart

[InstallDelete]
; An update starts from an empty program folder, so no file of the old version is left over.
; Only the program folder: no data lives there (see above).
Type: filesandordirs; Name: "{app}\*"
#if AppName != "AgOpenWeb"
; Shortcuts of the test versions named AgOpenWeb (the new ones carry the product name).
Type: files; Name: "{autodesktop}\AgOpenWeb.lnk"
Type: filesandordirs; Name: "{autoprograms}\AgOpenWeb"
#endif

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifdef WebView2Setup
Source: "{#WebView2Setup}"; DestDir: "{tmp}"; DestName: "MicrosoftEdgeWebview2Setup.exe"; Flags: deleteafterinstall; Check: not WebView2Installed
#endif

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
#ifdef WebView2Setup
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "{cm:WebView2Run}"; Flags: waituntilterminated; Check: not WebView2Installed
#endif
; Elevated through UAC (runas), also when installing for the current user only. Deletes first, so
; an update leaves exactly the two rules. Only this program, only from the local subnet.
Filename: "{sys}\cmd.exe"; Parameters: "/c netsh advfirewall firewall delete rule name=""{#FwUdp}"" & netsh advfirewall firewall delete rule name=""{#FwTcp}"" & netsh advfirewall firewall delete rule name=""{#FwOldUdp}"" & netsh advfirewall firewall delete rule name=""{#FwOldTcp}"" & netsh advfirewall firewall add rule name=""{#FwUdp}"" dir=in action=allow program=""{app}\{#AppExe}"" protocol=UDP localport=9999,2211,2222 remoteip=localsubnet profile=any enable=yes & netsh advfirewall firewall add rule name=""{#FwTcp}"" dir=in action=allow program=""{app}\{#AppExe}"" protocol=TCP localport=5174 remoteip=localsubnet profile=any enable=yes"; StatusMsg: "{cm:FirewallRun}"; Flags: shellexec runhidden waituntilterminated; Verb: "runas"; Tasks: firewall
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Removes the two rules again (also elevated); harmless if they were never created.
Filename: "{sys}\cmd.exe"; Parameters: "/c netsh advfirewall firewall delete rule name=""{#FwUdp}"" & netsh advfirewall firewall delete rule name=""{#FwTcp}"" & netsh advfirewall firewall delete rule name=""{#FwOldUdp}"" & netsh advfirewall firewall delete rule name=""{#FwOldTcp}"""; Flags: shellexec runhidden waituntilterminated; Verb: "runas"; RunOnceId: "RemoveFirewallRules"

; No [UninstallDelete]: uninstalling removes only what was installed. Documents\AgOpenWeb and
; the web view's storage stay, so a reinstall finds fields, profiles and the work log again.

[Code]
// WebView2 runtime present? Per machine (32-bit registry view) or per user, as Microsoft
// documents for the Evergreen runtime: the "pv" value holds the installed version.
const
  WebView2Key = '\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function WebView2Found(Root: Integer; Key: String): Boolean;
var
  V: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0');
end;

function WebView2Installed: Boolean;
begin
  Result := WebView2Found(HKLM32, 'SOFTWARE' + WebView2Key) or WebView2Found(HKCU, 'Software' + WebView2Key);
end;

#ifndef WebView2Setup
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and not WebView2Installed and not WizardSilent then
    MsgBox(CustomMessage('WebView2Missing'), mbInformation, MB_OK);
end;
#endif
