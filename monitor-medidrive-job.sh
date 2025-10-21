#!/bin/bash
# Quick monitor for the Medidrive job

JOB_ID="c1680e74-08f5-47ea-accc-797aef57f6c7"

echo "📊 Monitoring Medidrive Job: $JOB_ID"
echo ""

python monitor-content-job.py $JOB_ID

