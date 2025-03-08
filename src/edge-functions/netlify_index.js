const assetManifest = {};

export default async(request, env) => {
  try {
    // 添加 CORS 预检请求处理
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }
    
    const url = new URL(request.url);
    console.log('Request URL:', request.url);
    
    // 处理 WebSocket 连接
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return handleWebSocket(request, env);
    }
    
    // 添加 API 请求处理
    if (url.pathname.endsWith("/chat/completions") ||
        url.pathname.endsWith("/embeddings") ||
        url.pathname.endsWith("/models")) {
      return handleAPIRequest(request, env);
    }

    // 处理静态资源
    return await handleStaticContent(url, env);
    
  } catch (error) {
    console.error('Request handling error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(errorMessage, { 
      status: 500,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
};

// 新增静态资源处理函数
async function handleStaticContent(url, env) {
  let assetPath = url.pathname;
  
  // 处理根路径和 index.html
  if (assetPath === '/' || assetPath === '/index.html') {
    assetPath = '/index.html';
  }
  
  console.log('Trying to load asset:', assetPath);
  
  try {
    // 在Netlify环境中，我们需要使用fetch来获取静态资源
    // 构建相对于当前请求的静态资源URL
    const staticUrl = new URL(assetPath, url.origin);
    console.log('Fetching static asset from:', staticUrl.toString());
    
    const response = await fetch(staticUrl.toString());
    
    if (!response.ok) {
      console.error('Asset not found:', assetPath, 'Status:', response.status);
      
      // 尝试返回自定义404页面
      try {
        const notFoundUrl = new URL('/404.html', url.origin);
        const notFoundResponse = await fetch(notFoundUrl.toString());
        
        if (notFoundResponse.ok) {
          const notFoundContent = await notFoundResponse.arrayBuffer();
          return new Response(notFoundContent, { 
            status: 404,
            headers: {
              'content-type': 'text/html;charset=UTF-8',
            }
          });
        }
      } catch (notFoundError) {
        console.error('Error loading 404 page:', notFoundError);
      }
      
      // 如果无法加载自定义404页面，返回简单的404响应
      return new Response('Not Found', { 
        status: 404,
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
        }
      });
    }
    
    const contentType = getContentType(url.pathname);
    const asset = await response.arrayBuffer();
    
    return new Response(asset, {
      headers: {
        'content-type': `${contentType};charset=UTF-8`,
        'cache-control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Error fetching asset:', assetPath, error);
    return new Response('Error loading resource', { 
      status: 500,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
}

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
      // 使用绝对路径导入
      const worker = await import('/api_proxy/worker.mjs');
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
  