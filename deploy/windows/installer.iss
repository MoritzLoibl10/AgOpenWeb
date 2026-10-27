; AgOpenWeb
; Copyright (C) 2024-2026 AgOpenWeb Contributors
; SPDX-License-Identifier: Apache-2.0

; Windows installer for customers (fork, feature/installer), built with Inno Setup 6 from the
; launcher bundle that deploy/windows/package.sh publishes (the folder, unzipped).
;
;   ISCC.exe /DAppVersion=26.7.0-moritz.25 /DFileVersion=26.7.0.25 /DSourceDir=<bundle folder> ^
;            /DOutDir=<output folder> deploy\windows\installer.iss
;
; - Installs for the current user (no administrator needed) into %LOCALAPPDATA%\Programs\<name>;
;   an administrator may choose "for all users" in the first dialog.
; - Start menu entry, optional desktop shortcut, entry in "Apps" for uninstalling.
; - An update installs over the old version (same AppId); the app is closed first if it runs.
; - Data is never touched, neither by an update nor by uninstalling: fields, profiles, work log and
;   settings live in Documents\AgOpenWeb (AppDataRoot), the web view's storage in
;   %LOCALAPPDATA%\Photino. This script installs and removes only the program folder.
; - The port stays 5174: the app has it built in; the installer neither asks for nor sets one.
; - Not signed (see docs/Installer.md): Windows SmartScreen warns until the setup is signed.

#ifndef AppName
  #define AppName "AgOpenWeb"
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

[Setup]
; Fixed for every version: Windows recognises an update by it. Never change it.
AppId={{6C0E8A52-5D7B-4C1E-9A2F-3B8D41E7C905}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
VersionInfoVersion={#FileVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Fixed folder (no choice): an update empties the program folder first, which must never be a
; folder the user picked for something else.
DisableDirPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
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

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; An update starts from an empty program folder, so no file of the old version is left over.
; Only the program folder: no data lives there (see above).
Type: filesandordirs; Name: "{app}\*"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

; No [UninstallDelete]: uninstalling removes only what was installed. Documents\AgOpenWeb and
; the web view's storage stay, so a reinstall finds fields, profiles and the work log again.
