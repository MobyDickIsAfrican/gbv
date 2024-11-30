import { useState } from 'react';
import { Search } from 'lucide-react';
import './App.css';

interface Comment {
  text: string;
  userName: string;
  timestamp: string;
  likes: string;
  replies: string;
}

interface Tweet {
  tweet: string;
  userName: string;
  timestamp: string;
  likes: string;
  retweets: string;
  comments: Comment[];
  tweetUrl: string;
}

interface ScrapedData {
  tweets: Tweet[];
}

declare global {
  interface Window {
    _targetTweetCount: number;
  }
}

function App() {
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [tweetCount, setTweetCount] = useState<number>(50);
  const [copyStatus, setCopyStatus] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Injectable function to scroll and collect tweets
  const collectTweets = () => {
    // This function will be serialized and injected into the page
    function scrollAndCollect() {
      return new Promise<Tweet[]>((resolve) => {
        let previousHeight = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 50;
        const processedTweetUrls = new Set<string>();
        const tweets: Tweet[] = [];

        const scrollInterval = setInterval(() => {
          const tweetElements = document.querySelectorAll('[data-testid="cellInnerDiv"]');
          console.log(`Found ${tweetElements.length} total tweet elements`);

          tweetElements.forEach((tweetEl) => {
            const tweetLink = tweetEl.querySelector('a[href*="/status/"]');
            const tweetUrl = tweetLink ? tweetLink.getAttribute('href') : null;

            if (!tweetUrl || processedTweetUrls.has(tweetUrl)) return;

            const tweetTextEl = tweetEl.querySelector('[data-testid="tweetText"]');
            const userNameEl = tweetEl.querySelector('[data-testid="User-Name"]');
            const timeEl = tweetEl.querySelector('time');
            const likeEl = tweetEl.querySelector('[data-testid="like"]');
            const retweetEl = tweetEl.querySelector('[data-testid="retweet"]');

            const tweet: Tweet = {
              tweet: tweetTextEl ? tweetTextEl.textContent || '' : '',
              userName: userNameEl ? userNameEl.textContent || '' : '',
              timestamp: timeEl ? timeEl.getAttribute('datetime') || '' : '',
              likes: likeEl ? likeEl.getAttribute('aria-label')?.split(' ')[0] || '0' : '0',
              retweets: retweetEl ? retweetEl.getAttribute('aria-label')?.split(' ')[0] || '0' : '0',
              tweetUrl,
              comments: []
            };

            tweets.push(tweet);
            processedTweetUrls.add(tweetUrl);
            console.log(`Processed tweet: ${tweetUrl}`);
          });

          window.scrollTo(0, document.body.scrollHeight);
          const currentHeight = document.body.scrollHeight;
          scrollAttempts++;

          if (
            (currentHeight === previousHeight) ||
            (tweets.length >= window._targetTweetCount) ||
            (scrollAttempts >= maxScrollAttempts)
          ) {
            clearInterval(scrollInterval);
            console.log(`Scrolling complete. Found ${tweets.length} unique tweets`);
            resolve(tweets);
            return;
          }

          previousHeight = currentHeight;
        }, 1500);
      });
    }

    return scrollAndCollect();
  };

  const copyJsonToClipboard = () => {
    if (!scrapedData) return;

    try {
      // Create a formatted JSON structure
      const formattedData = {
        totalTweets: scrapedData.tweets.length,
        searchItem: searchTerm,
        scrapeTimestamp: new Date().toISOString(),
        tweets: scrapedData.tweets.map(tweet => ({
          content: tweet.tweet,
          metadata: {
            author: tweet.userName,
            postedAt: tweet.timestamp,
            engagement: {
              likes: tweet.likes,
              retweets: tweet.retweets,
              commentCount: tweet.comments.length
            },
            url: tweet.tweetUrl
          },
          comments: tweet.comments.map(comment => ({
            content: comment.text,
            metadata: {
              author: comment.userName,
              postedAt: comment.timestamp,
              engagement: {
                likes: comment.likes,
                replies: comment.replies
              }
            }
          }))
        }))
      };

      // Convert to a pretty-printed JSON string
      const jsonString = JSON.stringify(formattedData, null, 2);

      // Copy to clipboard
      navigator.clipboard.writeText(jsonString).then(() => {
        setCopyStatus('JSON copied to clipboard!');
        setTimeout(() => setCopyStatus(''), 3000);
      }).catch(err => {
        setCopyStatus('Failed to copy JSON');
        console.error('Failed to copy JSON:', err);
      });
    } catch (err) {
      setCopyStatus('Error formatting JSON');
      console.error('Error formatting JSON:', err);
    }
  };

  const scrapeComments = async (tweetUrl: string): Promise<Comment[]> => {
    try {
      console.log(`Scraping comments for tweet: ${tweetUrl}`);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab found');

      await chrome.tabs.update(tab.id, { url: `https://twitter.com${tweetUrl}` });
      await new Promise(resolve => setTimeout(resolve, 3000));

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const comments: Comment[] = [];
          const commentElements = document.querySelectorAll('[data-testid="tweet"]');

          commentElements.forEach((commentEl) => {
            const comment = {
              text: commentEl.querySelector('[data-testid="tweetText"]')?.textContent || '',
              userName: commentEl.querySelector('[data-testid="User-Name"]')?.textContent || '',
              timestamp: commentEl.querySelector('time')?.getAttribute('datetime') || '',
              likes: commentEl.querySelector('[data-testid="like"]')?.getAttribute('aria-label')?.split(' ')[0] || '0',
              replies: commentEl.querySelector('[data-testid="reply"]')?.getAttribute('aria-label')?.split(' ')[0] || '0'
            };
            comments.push(comment);
          });

          return comments;
        },
      });

      return result.result || [];
    } catch (error) {
      console.error('Error scraping comments:', error);
      return [];
    }
  };

  const scrapeTweets = async () => {
    setIsLoading(true);
    setError(null);
    setProgress('Starting tweet scraping...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Current tab:', tab);

      if (!tab.id) {
        throw new Error('No active tab found');
      }

      setProgress('Finding tweets...');

      // Inject the target tweet count
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (count: number) => {
          window._targetTweetCount = count;
        },
        args: [tweetCount]
      });

      // Execute the tweet collection
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectTweets,
      });

      console.log('Initial scrape result:', result);

      if (!result?.result?.length) {
        throw new Error('No tweets found on this page');
      }

      const originalUrl = tab.url;
      const tweets = result.result as Tweet[];

      // Scrape comments for each tweet
      for (let i = 0; i < tweets.length; i++) {
        setProgress(`Scraping comments for tweet ${i + 1} of ${tweets.length}...`);

        if (tweets[i].tweetUrl) {
          const comments = await scrapeComments(tweets[i].tweetUrl);
          tweets[i].comments = comments;
        }
      }

      // Return to original page
      if (originalUrl) {
        await chrome.tabs.update(tab.id, { url: originalUrl });
      }

      setScrapedData({ tweets });
      console.log('Final scraped data:', { tweets });
      setProgress('Scraping completed successfully!');
    } catch (err) {
      console.error('Scraping error:', err);
      setError('Error scraping tweets: ' + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto p-6">
        {/* Clean, Minimal Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">Tweet Scraper</h1>
          <p className="text-slate-600">Extract and analyze Twitter content with ease</p>
        </div>

        {/* Main Input Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          {/* Search Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Search Term
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Enter search term..."
                className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Tweet Count Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Number of tweets to scrape
            </label>
            <input
              type="number"
              min="1"
              max="1000"
              value={tweetCount}
              onChange={(e) => setTweetCount(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Action Buttons in a Clean Layout */}
          <div className="flex gap-3">
            <button
              onClick={scrapeTweets}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-sm"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Scraping...
                </span>
              ) : (
                'Scrape Tweets'
              )}
            </button>

            {scrapedData && (
              <button
                onClick={copyJsonToClipboard}
                className="flex-1 px-4 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors font-medium text-sm"
              >
                Copy JSON
              </button>
            )}
          </div>

          {/* Status Messages with Clean Styling */}
          {copyStatus && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              {copyStatus}
            </div>
          )}

          {progress && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              {progress}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        {/* Results Section */}
        {scrapedData && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-800">Scraped Tweets</h2>
              <span className="px-2.5 py-1 bg-blue-100 text-blue-800 text-sm rounded-full font-medium">
                {scrapedData.tweets.length}
              </span>
            </div>

            <div className="space-y-4">
              {scrapedData.tweets.map((tweet, index) => (
                <div key={index} className="p-4 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-600 font-medium">{tweet.userName[0]}</span>
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{tweet.userName}</div>
                      <div className="text-sm text-slate-500">{new Date(tweet.timestamp).toLocaleString()}</div>
                    </div>
                  </div>

                  <p className="text-slate-800 mb-3 ml-13">{tweet.tweet}</p>

                  <div className="flex gap-4 text-slate-600 text-sm">
                    <span className="flex items-center gap-1">💬 {tweet.comments.length}</span>
                    <span className="flex items-center gap-1">🔄 {tweet.retweets}</span>
                    <span className="flex items-center gap-1">❤️ {tweet.likes}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;