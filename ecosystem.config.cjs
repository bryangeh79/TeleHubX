module.exports = {
  "apps": [
    {
      "name": "telehubx-server",
      "cwd": "C:\\AI_WORKSPACE\\Telegram Auto Bot/apps/server",
      "script": "dist/main.js",
      "env": {
        "NODE_ENV": "production",
        "APP_PORT": 9800,
        "DB_HOST": "localhost",
        "DB_PORT": "5436",
        "DB_USER": "telehubx",
        "DB_PASSWORD": "telehubx",
        "DB_NAME": "telehubx",
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6386",
        "DB_LOGGING": "false",
        "SYNC_DB": "true"
      },
      "max_restarts": 10,
      "restart_delay": 3000,
      "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
      "error_file": "C:/AI_WORKSPACE/Telegram Auto Bot/logs/server-error.log",
      "out_file": "C:/AI_WORKSPACE/Telegram Auto Bot/logs/server-out.log",
      "merge_logs": true
    }
  , {"args":"--host --port 9601","error_file":"C:\\AI_WORKSPACE\\Telegram Auto Bot\\logs\\dashboard-error.log","out_file":"C:\\AI_WORKSPACE\\Telegram Auto Bot\\logs\\dashboard-out.log","cwd":"C:\\AI_WORKSPACE\\Telegram Auto Bot\\apps\\dashboard","merge_logs":true,"log_date_format":"YYYY-MM-DD HH:mm:ss Z","max_restarts":10,"name":"telehubx-dashboard","env":{"NODE_ENV":"production"},"script":"node_modules\\vite\\bin\\vite.js","restart_delay":3000}
  , {
      "name": "telehubx-agent",
      "cwd": "C:\\AI_WORKSPACE\\Telegram Auto Bot\\apps\\agent",
      "script": "dist/main.js",
      "env": {
        "NODE_ENV": "production"
      },
      "max_restarts": 5,
      "restart_delay": 5000,
      "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
      "error_file": "C:/AI_WORKSPACE/Telegram Auto Bot/logs/agent-error.log",
      "out_file": "C:/AI_WORKSPACE/Telegram Auto Bot/logs/agent-out.log",
      "merge_logs": true
  }]
};
