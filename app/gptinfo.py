import requests
import pandas as pd
import plotly.express as px
import streamlit as st

# -------------------------------
# CONFIG
# -------------------------------
HEADERS = {
    "User-Agent": "FindQuan kaanthegamer24@gmail.com"
}

TICKER_TO_CIK = {
    "AAPL": "0000320193",
    "MSFT": "0000789019",
    "GOOGL": "0001652044",
    "AMZN": "0001018724",
    "META": "0001326801"
}

# -------------------------------
# FUNCTIONS
# -------------------------------
def get_company_facts(cik):
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    response = requests.get(url, headers=HEADERS)
    return response.json()

def extract_metric(data, tag, unit="USD"):
    try:
        metric = data["facts"]["us-gaap"][tag]["units"][unit]
        df = pd.DataFrame(metric)
        df = df[df["form"] == "10-K"]
        df["end"] = pd.to_datetime(df["end"])
        return df.sort_values("end")
    except KeyError:
        return None

def plot_metric(df, title, y_label):
    fig = px.line(
        df,
        x="end",
        y="val",
        markers=True,
        labels={"val": y_label, "end": "Year"},
        title=title
    )
    fig.update_layout(template="plotly_white")
    return fig

# -------------------------------
# STREAMLIT UI
# -------------------------------
st.set_page_config(page_title="SEC Financial Visualizer", layout="wide")

st.title("📊 SEC EDGAR Financial Visualizer")
st.write("Type a stock ticker to see clean financial charts from SEC filings.")

ticker = st.text_input("Enter stock ticker (AAPL, MSFT, etc)").upper()

if ticker:
    if ticker not in TICKER_TO_CIK:
        st.error("Ticker not in demo list yet.")
    else:
        cik = TICKER_TO_CIK[ticker]
        data = get_company_facts(cik)

        col1, col2 = st.columns(2)

        # Revenue
        revenue_df = extract_metric(data, "Revenues")
        if revenue_df is not None:
            with col1:
                st.plotly_chart(
                    plot_metric(
                        revenue_df,
                        f"{ticker} Revenue (Annual)",
                        "Revenue (USD)"
                    ),
                    use_container_width=True
                )

        # Net Income
        income_df = extract_metric(data, "NetIncomeLoss")
        if income_df is not None:
            with col2:
                st.plotly_chart(
                    plot_metric(
                        income_df,
                        f"{ticker} Net Income (Annual)",
                        "Net Income (USD)"
                    ),
                    use_container_width=True
                )

        # Dividends
        dividend_df = extract_metric(data, "DividendsPerShareDeclared", unit="USD/shares")
        if dividend_df is not None:
            st.plotly_chart(
                plot_metric(
                    dividend_df,
                    f"{ticker} Dividends Per Share",
                    "Dividends (USD)"
                ),
                use_container_width=True
            )
