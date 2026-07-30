' Logexus Native Host — 静默启动脚本（无命令行窗口）
' 将此脚本的快捷方式放入 shell:startup 即可开机自启

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node ""D:\CCWorkSpace\LogexusAIBrowser\native-host\host.js""", 0, False
