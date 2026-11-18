Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dirPath = fso.GetParentFolderName(WScript.ScriptFullName)
logPath = dirPath & "\launcher.log"

Function FindNode()
  FindNode = ""
  candidates = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\node.exe", _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe")
  For Each p In candidates
    If fso.FileExists(p) Then
      FindNode = p
      Exit Function
    End If
  Next
  For Each d In Split(sh.ExpandEnvironmentStrings("%PATH%"), ";")
    d = Trim(d)
    If Len(d) > 0 Then
      If Left(d, 1) = Chr(34) And Right(d, 1) = Chr(34) Then d = Mid(d, 2, Len(d) - 2)
      cand = d & "\node.exe"
      If fso.FileExists(cand) Then
        FindNode = cand
        Exit Function
      End If
    End If
  Next
End Function

nodePath = FindNode()
If nodePath = "" Then
  fso.OpenTextFile(logPath, 8, True).WriteLine Now & " node.exe not found"
  WScript.Quit
End If
scriptPath = dirPath & "\launch.js"
If Not fso.FileExists(scriptPath) Then
  fso.OpenTextFile(logPath, 8, True).WriteLine Now & " launch.js missing"
  WScript.Quit
End If

' node.exe is a console subsystem program. WScript.Shell.Exec takes no window
' style, so the system gives it a visible console window (a brief flash).
' Use Run with window style 0 (SW_HIDE) instead: the process runs normally and
' its console window is hidden from the moment it is created.
q = Chr(34)
cmdLine = q & nodePath & q & " " & q & scriptPath & q
On Error Resume Next
sh.Run cmdLine, 0, False
If Err.Number <> 0 Then
  fso.OpenTextFile(logPath, 8, True).WriteLine Now & " run failed: " & Err.Description
  Err.Clear
End If
