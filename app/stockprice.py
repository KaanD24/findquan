import yfinance as yf
import matplotlib.pyplot as plt
ticker = input("Input Ticker: ")
data = yf.download(f"{ticker}", start="2023-01-01", end="2026-01-01")
data = data.reset_index()
dates = list(data['Date'])
close = list(data['Close'][f"{ticker}"])

plt.plot(dates, close)
plt.xlabel('Date')
plt.ylabel('Price')
plt.title(f'{ticker} Stock Price')
plt.show()