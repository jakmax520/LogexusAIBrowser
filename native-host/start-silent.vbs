' Logexus AI Browser — Native Host 静默启动脚本
' 无命令行窗口，后台运行
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
cmd = "node """ & scriptDir & "\host.js"""
WshShell.Run cmd, 0, False
