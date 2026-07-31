#!/bin/bash
# Logexus NM wrapper — 使用 nvm node 绝对路径 + stderr 日志
exec 2>>/tmp/logexus-nm.log
echo "$(date): NM starting with node $NVM_BIN" >&2
exec /Users/jason/.nvm/versions/node/v24.16.0/bin/node /Volumes/macData/workspace/GitHubSpace/LogexusAIBrowser/native-host/host.js --nm "$@"
