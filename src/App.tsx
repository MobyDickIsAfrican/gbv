import { useState } from 'react';
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
}

interface ScrapedData {
  tweets: Tweet[];
}

function App() {
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  // Separate function to be injected into the page context
  const scrapePageContent = () => {
    console.log("Starting scrape operation...");

    const tweetElements = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    console.log(`Found ${tweetElements.length} tweet elements`);

    const tweets: any[] = [];

    tweetElements.forEach((tweetEl, index) => {
      console.log(`Processing tweet ${index + 1}`);

      // Find the tweet link first
      const tweetLink = tweetEl.querySelector('a[href*="/status/"]');
      const tweetUrl = tweetLink ? tweetLink.getAttribute('href') : null;

      const tweetTextEl = tweetEl.querySelector('[data-testid="tweetText"]');
      const userNameEl = tweetEl.querySelector('[data-testid="User-Name"]');
      const timeEl = tweetEl.querySelector('time');
      const likeEl = tweetEl.querySelector('[data-testid="like"]');
      const retweetEl = tweetEl.querySelector('[data-testid="retweet"]');

      const tweet = {
        tweet: tweetTextEl ? tweetTextEl.textContent || '' : '',
        userName: userNameEl ? userNameEl.textContent || '' : '',
        timestamp: timeEl ? timeEl.getAttribute('datetime') || '' : '',
        likes: likeEl ? likeEl.getAttribute('aria-label')?.split(' ')[0] || '0' : '0',
        retweets: retweetEl ? retweetEl.getAttribute('aria-label')?.split(' ')[0] || '0' : '0',
        tweetUrl: tweetUrl || '',
        comments: [] // Will be populated later
      };

      console.log(`Tweet ${index + 1} data:`, tweet);
      tweets.push(tweet);
    });

    console.log(`Scraping complete. Found ${tweets.length} tweets`);
    return { tweets };
  };

  const scrapeComments = async (tweetUrl: string) => {
    try {
      console.log(`Scraping comments for tweet: ${tweetUrl}`);

      // Execute script to get comments from the tweet page
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) throw new Error('No active tab found');

      // Navigate to tweet page
      await chrome.tabs.update(tab.id, { url: `https://twitter.com${tweetUrl}` });

      // Wait for navigation and content to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const comments: any[] = [];
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
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePageContent,
      });

      console.log('Initial scrape result:', result);

      if (!result || !result.result || !result.result.tweets || result.result.tweets.length === 0) {
        throw new Error('No tweets found on this page');
      }

      // Store the original URL to return to later
      const originalUrl = tab.url;
      const tweets = [...result.result.tweets];

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
    <div className="App">
      <h1>Tweet Scraper</h1>
      <button
        onClick={scrapeTweets}
        disabled={isLoading}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
      >
        {isLoading ? 'Scraping...' : 'Scrape Tweets'}
      </button>

      {progress && <p className="text-blue-500 mt-2">{progress}</p>}
      {error && <p className="text-red-500 mt-4">{error}</p>}

      {scrapedData && (
        <div className="mt-6">
          <h2 className="text-xl font-bold mb-4">Scraped Tweets:</h2>
          <ul className="space-y-4">
            {scrapedData.tweets.map((tweet, index) => (
              <li key={index} className="border p-4 rounded-lg">
                <div className="flex justify-between items-start">
                  <strong className="text-lg">{tweet.userName}</strong>
                  <span className="text-gray-500">{new Date(tweet.timestamp).toLocaleString()}</span>
                </div>
                <p className="my-2">{tweet.tweet}</p>
                <div className="flex gap-4 text-gray-600">
                  <span>💬 {tweet.comments.length}</span>
                  <span>🔄 {tweet.retweets}</span>
                  <span>❤️ {tweet.likes}</span>
                </div>

                {tweet.comments.length > 0 && (
                  <div className="mt-4 pl-4 border-l-2 border-gray-200">
                    <h3 className="font-bold mb-2">Comments:</h3>
                    <ul className="space-y-2">
                      {tweet.comments.map((comment, commentIndex) => (
                        <li key={commentIndex} className="bg-gray-50 p-3 rounded">
                          <div className="flex justify-between items-start">
                            <strong>{comment.userName}</strong>
                            <span className="text-sm text-gray-500">
                              {new Date(comment.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1">{comment.text}</p>
                          <div className="flex gap-3 text-sm text-gray-600 mt-1">
                            <span>💬 {comment.replies}</span>
                            <span>❤️ {comment.likes}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;