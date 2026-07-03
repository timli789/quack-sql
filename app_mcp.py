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

@mcp.tool()
def analyze_win_rates(ticker_pattern: str, min_volume: int = 1000) -> str:
    """Analyze the win rates of resolved Kalshi markets matching a ticker pattern (e.g. 'KXWC%' or 'KXMLB%'),
    grouped by 5-cent price increments of the trades.
    Filters:
      - Only includes finalized/resolved markets (status = 'finalized' and result is 'yes' or 'no')
      - Only includes markets with total volume >= min_volume (to exclude thin/untraded options)
    """
    query = """
    WITH filtered_markets AS (
        SELECT ticker, result
        FROM kalshi_markets
        WHERE (ticker LIKE ? OR title LIKE ?)
          AND status = 'finalized'
          AND result IS NOT NULL 
          AND result IN ('yes', 'no')
          AND volume >= ?
    ),
    wc_trades AS (
        SELECT 
            t.ticker,
            t.count as contract_volume,
            t.taker_side,
            CASE 
                WHEN t.taker_side = 'yes' THEN t.yes_price 
                ELSE t.no_price 
            END as price_paid,
            CASE 
                WHEN t.taker_side = m.result THEN 1 
                ELSE 0 
            END as is_win
        FROM kalshi_trades t
        JOIN filtered_markets m ON t.ticker = m.ticker
    ),
    binned_trades AS (
        SELECT 
            contract_volume,
            price_paid,
            is_win,
            CAST(FLOOR((price_paid - 1) / 5) AS INT) as bin_idx
        FROM wc_trades
        WHERE price_paid IS NOT NULL AND price_paid >= 1 AND price_paid <= 100
    )
    SELECT 
        printf('%02d-%02d', bin_idx * 5 + 1, bin_idx * 5 + 5) as price_range,
        COUNT(*) as num_trades,
        SUM(contract_volume) as total_contracts,
        SUM(is_win) as winning_trades,
        SUM(CASE WHEN is_win = 1 THEN contract_volume ELSE 0 END) as winning_contracts,
        ROUND(SUM(is_win) * 100.0 / COUNT(*), 2) as win_rate_trades_pct,
        ROUND(SUM(CASE WHEN is_win = 1 THEN contract_volume ELSE 0 END) * 100.0 / SUM(contract_volume), 2) as win_rate_contracts_pct
    FROM binned_trades
    GROUP BY bin_idx
    ORDER BY bin_idx;
    """
    try:
        # We search both ticker and title with the pattern
        search_pattern = ticker_pattern
        title_pattern = f"%{ticker_pattern.replace('%', '')}%"
        rel = db.execute(query, [search_pattern, title_pattern, min_volume])
        df = rel.df()
        if df.empty:
            return "No data found matching the specified pattern and volume criteria."
        
        # Format as Markdown table manually to avoid dependency on tabulate
        headers = list(df.columns)
        lines = ["| " + " | ".join(headers) + " |"]
        lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for _, row in df.iterrows():
            lines.append("| " + " | ".join(str(val) for val in row) + " |")
        return "\n".join(lines)
    except Exception as e:
        return f"Error executing analysis: {str(e)}"

if __name__ == "__main__":
    mcp.run()
