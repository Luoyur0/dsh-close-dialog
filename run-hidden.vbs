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
      If Left(d, 1) = """" And Right(d, 1) = """" Then d = Mid(d, 2, Len(d) - 2)
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
On Error Resume Next
Set execObj = sh.Exec("""" & nodePath & """ """ & scriptPath & """")
If Err.Number <> 0 Then
  fso.OpenTextFile(logPath, 8, True).WriteLine Now & " exec failed: " & Err.Description
  Err.Clear
End If
