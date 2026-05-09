
import os
import collections

migrations_dir = r'supabase\migrations'
files = [f for f in os.listdir(migrations_dir) if f.endswith('.sql')]

# Check for duplicate timestamps
timestamps = [f[:14] for f in files]
duplicates = [item for item, count in collections.Counter(timestamps).items() if count > 1]

if duplicates:
    print(f"Found duplicate timestamps: {duplicates}")
    for d in duplicates:
        matching = [f for f in files if f.startswith(d)]
        print(f"  {matching}")
else:
    print("No duplicate timestamps found.")

# Check for potential SQL syntax issues in most recent migrations
recent_files = sorted(files)[-5:]
print(f"\nRecent migrations: {recent_files}")
