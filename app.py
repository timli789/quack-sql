import os
import duckdb
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any
import glob

app = FastAPI(title="QuackSQL")

# Configuration
DATA_DIR = os.environ.get("QUACK_DATA_DIR", "/Users/timli/prediction-market-analysis-main/data")
DB_NAME = ":memory:"

# Initialize DuckDB
db = duckdb.connect(DB_NAME)

class QueryRequest(BaseModel):
    sql: str

def discover_parquet_files():
    """Discover directories containing parquet files and create views."""

    views = []
    # Hardcoded sources based on known structure to avoid massive recursive glob
    sources = ["kalshi", "polymarket"]
    
    for source in sources:
        source_path = os.path.join(DATA_DIR, source)
        if not os.path.exists(source_path):
            continue
            
        # Get table types (e.g., trades, markets)
        for table_type in os.listdir(source_path):
            directory = os.path.join(source_path, table_type)
            if not os.path.isdir(directory):
                continue
                
            # Check if directory has parquet files
            parquet_files = glob.glob(os.path.join(directory, "*.parquet"))
            if not parquet_files:
                continue
                
            view_name = f"{source}_{table_type}".lower()
            
            try:
                # Create view in DuckDB
                query = f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{directory}/*.parquet')"
                db.execute(query)
                
                # Get column names
                desc = db.execute(f"DESCRIBE {view_name}").df()
                cols = [
                    {"name": row["column_name"], "type": row["column_type"]}
                    for _, row in desc.iterrows()
                ]
                
                views.append({
                    "name": view_name,
                    "path": directory,
                    "files_count": len(parquet_files),
                    "columns": cols
                })
                print(f"Created view: {view_name} with {len(cols)} columns")
            except Exception as e:
                print(f"Error creating view {view_name}: {str(e)}")
            
    return views

@app.get("/api/schema")
async def get_schema():
    """Return the list of available views/tables."""
    # Always refresh to ensure deleted tables are removed
    views = discover_parquet_files()
    return {"views": views}

@app.post("/api/execute")
async def execute_query(request: QueryRequest):
    """Execute a SQL query and return results."""
    try:
        # Use DuckDB to execute and fetch as a DataFrame for easy JSON conversion
        rel = db.sql(request.sql)
        if rel is None:
            return {"columns": [], "rows": [], "message": "Query executed successfully (no results)."}
            
        # Limit results for the web interface
        df = rel.limit(1000).df()
        
        # Convert to JSON-friendly format
        # Replace NaNs with None for JSON compatibility
        df = df.where(pd.notnull(df), None)
        
        # Convert datetime objects to strings
        for col in df.select_dtypes(include=['datetime64', 'datetimetz']).columns:
            df[col] = df[col].astype(str)
            
        columns = df.columns.tolist()
        rows = df.values.tolist()
        
        return {
            "columns": columns,
            "rows": rows,
            "total_rows": len(df)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Serve frontend
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
