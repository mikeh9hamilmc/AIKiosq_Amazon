---
description: Force close port 3001 if address already in use
---

// turbo-all
1. Force close the process occupying port 3001.
```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess -Force
```
