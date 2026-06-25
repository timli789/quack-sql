import os
import glob
import duckdb
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP Server
mcp = FastMCP("OldMacDuckDB")

# Configuration
DATA_DIR = os.environ.get("QUACK_DATA_DIR", "/Users/tim/Documents/prediction-market-analysis-legacy/data")
db = duckdb.connect(":memory:")

# Apply resource limits for 2013 MacBook Pro
db.execute("PRAGMA max_memory='3GB'")
db.execute("PRAGMA threads=2")

# Create views for Parquet files on startup
sources = ["kalshi", "polymarket"]
for source in sources:
    source_path = os.path.join(DATA_DIR, source)
    if os.path.exists(source_path):
        for table_type in os.listdir(source_path):
            directory = os.path.join(source_path, table_type)
            if os.path.isdir(directory):
                parquet_files = glob.glob(os.path.join(directory, "*.parquet"))
                if parquet_files:
                    view_name = f"{source}_{table_type}".lower()
                    db.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{directory}/*.parquet')")

@mcp.tool()
def execute_sql(sql_query: str) -> str:
    """Execute a SQL query against the Kalshi and Polymarket datasets and return the results as text.
    Available tables:
      - kalshi_markets
      - kalshi_trades
      - polymarket_markets
      - polymarket_trades
    """
    try:
        # Limit rows to prevent output bloat
        rel = db.sql(sql_query)
        if rel is None:
            return "Query executed successfully (no results)."
        df = rel.limit(200).df()
        return df.to_string(index=False)
    except Exception as e:
        return f"Error executing query: {str(e)}"

if __name__ == "__main__":
    mcp.run()
