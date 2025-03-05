const assetManifest = {};

export default async(request, env) => {
  try {
    const url = new URL(request.url);
    
    // 处理 WebSocket 连接
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, env);
    }
    
    // 添加 API 请求处理
    if (url.pathname.endsWith("/chat/completions") ||
        url.pathname.endsWith("/embeddings") ||
        url.pathname.endsWith("/models")) {
      return handleAPIRequest(request, env);
    }

    // 处理静态资源
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await env.__STATIC_CONTENT.get('index.html');
      if (!html) {
        console.error('index.html not found');
        return new Response('Not Found', { status: 404 });
      }
      return new Response(html, {
        headers: {
          'content-type': 'text/html;charset=UTF-8',
        },
      });
    }

    // 处理其他静态资源
    let assetPath = url.pathname;
    if (assetPath.startsWith('/')) {
      assetPath = assetPath.slice(1);
    }
    
    console.log('Trying to load asset:', assetPath);
    const asset = await env.__STATIC_CONTENT.get(assetPath);
    
    if (asset) {
      const contentType = getContentType(url.pathname);
      return new Response(asset, {
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=31536000',
        },
      });
    }

    console.error('Asset not found:', assetPath);
    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('Request handling error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

function getContentType(path) {
    const ext = path.split('.').pop().toLowerCase();
    const types = {
      'js': 'application/javascript',
      'css': 'text/css',
      'html': 'text/html',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif'
    };
    return types[ext] || 'text/plain';
  }
  
  async function handleWebSocket(request, env) {
    try {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket connection", { status: 400 });
      }
      
      const url = new URL(request.url);
      const pathAndQuery = url.pathname + url.search;
      const targetUrl = `wss://generativelanguage.googleapis.com${pathAndQuery}`;
        
      console.log('Target URL:', targetUrl);
      
      const [client, proxy] = new WebSocketPair();
      proxy.accept();
      
      let pendingMessages = [];
      const targetWebSocket = new WebSocket(targetUrl);
     
      targetWebSocket.addEventListener("open", () => {
        console.log('Connected to target server');
        for (const message of pendingMessages) {
          try {
            targetWebSocket.send(message);
          } catch (error) {
            console.error('Error sending pending message:', error);
          }
        }
        pendingMessages = [];
      });
     
      proxy.addEventListener("message", async (event) => {
        if (targetWebSocket.readyState === WebSocket.OPEN) {
          try {
            targetWebSocket.send(event.data);
          } catch (error) {
            console.error('Error sending to gemini:', error);
          }
        } else {
          pendingMessages.push(event.data);
        }
      });
     
      targetWebSocket.addEventListener("message", (event) => {
        try {
          if (proxy.readyState === WebSocket.OPEN) {
            proxy.send(event.data);
          }
        } catch (error) {
          console.error('Error forwarding to client:', error);
        }
      });
     
      targetWebSocket.addEventListener("close", (event) => {
        if (proxy.readyState === WebSocket.OPEN) {
          proxy.close(event.code, event.reason);
        }
      });
     
      proxy.addEventListener("close", (event) => {
        if (targetWebSocket.readyState === WebSocket.OPEN) {
          targetWebSocket.close(event.code, event.reason);
        }
      });
     
      targetWebSocket.addEventListener("error", (error) => {
        console.error('Gemini WebSocket error:', error);
      });
     
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    } catch (error) {
      console.error('WebSocket handling error:', error);
      return new Response('WebSocket Error', { status: 500 });
    }
  }
  
  async function handleAPIRequest(request, env) {
    try {
      const worker = await import('../api_proxy/worker.mjs');
      return await worker.default.fetch(request);
    } catch (error) {
      console.error('API request error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const errorStatus = error.status || 500;
      return new Response(errorMessage, {
        status: errorStatus,
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
        }
      });
    }
  }
  