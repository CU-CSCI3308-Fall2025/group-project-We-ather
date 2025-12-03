#!/bin/bash

# DO NOT PUSH THIS FILE TO GITHUB
# This file contains sensitive information and should be kept private

# TODO: Set your PostgreSQL URI - Use the External Database URL from the Render dashboard
PG_URI="postgresql://users_db_tia4_user:yg8debGN4TUz7W8v6LYU0Aqa0hlu3Q5h@dpg-d4o9bpali9vc73cb7b60-a.oregon-postgres.render.com/users_db_tia4"

# Execute each .sql file in the directory
for file in init_data/*.sql; do
    echo "Executing $file..."
    psql $PG_URI -f "$file"
done