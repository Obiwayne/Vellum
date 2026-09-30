' Opens Vellum without a console window. Runs Vellum.cmd hidden, so the app is rebuilt first when
' its code changed (after a git pull or an edit). Used by the shortcuts from make-shortcuts.ps1.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
sh.Run """" & root & "\Vellum.cmd""", 0, False
