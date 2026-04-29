module.exports = {
  "apps": [
    {
      "name": "telehubx-server",
      "cwd": "C:\\AI_WORKSPACE\\Telegram Auto Bot/apps/server",
      "script": "dist/main.js",
      "env": {
        "NODE_ENV": "production",
        "APP_PORT": 9600,
        "DB_HOST": "localhost",
        "DB_PORT": "5433",
        "DB_USER": "telehubx",
        "DB_PASSWORD": "telehubx",
        "DB_NAME": "telehubx",
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "DB_LOGGING": "false"
      },
      "max_restarts": 10,
      "restart_delay": 3000,
      "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
      "error_file": "C:/AI_WORKSPACE/Telegram Auto Bot/logs/server-error.log",
      "out_file": "C:/AI_WORKSPACE/Telegram Auto Bot/logs/server-out.log",
      "merge_logs": true
    }
  , {"args":"--host --port 3000","error_file":"C:\\AI_WORKSPACE\\Telegram Auto Bot\\logs\\dashboard-error.log","out_file":"C:\\AI_WORKSPACE\\Telegram Auto Bot\\logs\\dashboard-out.log","cwd":"C:\\AI_WORKSPACE\\Telegram Auto Bot\\apps\\dashboard","merge_logs":true,"log_date_format":"YYYY-MM-DD HH:mm:ss Z","max_restarts":10,"name":"telehubx-dashboard","env":{"NODE_ENV":"production"},"script":"node_modules\\vite\\bin\\vite.js","restart_delay":3000}]
};
