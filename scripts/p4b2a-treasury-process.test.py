#!/usr/bin/env python3
"""Socket-capable isolated treasury authorization acceptance. No public chain execution."""
import os,sys,subprocess
from pathlib import Path
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
node=os.environ.get('CARECART_NODE_BIN','node')
result=subprocess.run([node,'--import','tsx','test-support/tenant-treasury-process.ts'],cwd=root/'backend',env={**os.environ,'CARECART_AUTH_MODE':'supabase'},check=False)
sys.exit(result.returncode)
