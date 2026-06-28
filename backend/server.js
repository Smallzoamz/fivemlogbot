import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_xyz123';
const BOT_API_KEY = process.env.BOT_API_KEY || 'fivem_admin_bot_api_key_xyz123';

// Configure middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Initialize Supabase Connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('CRITICAL ERROR: SUPABASE_URL or SUPABASE_KEY is missing from environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Multer storage in memory for Vercel Serverless
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper to parse JSON fields safely
function parseJsonField(val) {
  if (!val) return [];
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch (e) {
      return [];
    }
  }
  return val;
}

// Helper: Check if details content contains close ticket keywords to skip storing it
function shouldSkipLog(text) {
  if (!text) return false;
  const lowercaseText = text.toLowerCase();
  const skipKeywords = [
    'ปิดทิกเกทสำเร็จ',
    'ปิดทิกเก็ตสำเร็จ',
    'ปิดเคสสำเร็จ',
    'ปิดเคสเรียบร้อย',
    'ปิดตั๋วเคส',
    'ticket closed'
  ];
  return skipKeywords.some(keyword => lowercaseText.includes(keyword));
}

// MIDDLEWARES

// 1. Authenticate JWT Token for Web Frontend
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token invalid or expired' });
    req.user = user;
    next();
  });
}

// 2. Authenticate Bot request
function authenticateBot(req, res, next) {
  const botToken = req.headers['x-bot-token'];
  if (!botToken || botToken !== BOT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized bot access' });
  }
  next();
}


// --- DISCORD OAUTH2 ROUTES ---

// Redirect to Discord OAuth screen
app.get('/api/auth/discord/login', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'Discord Client ID or Redirect URI not configured in server env' });
  }

  const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify`;
  res.redirect(oauthUrl);
});

// OAuth Callback handler
app.get('/api/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!code) {
    return res.redirect(`${frontendUrl}/login-error?reason=no_code`);
  }

  try {
    // 1. Exchange Code for Token
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code.toString(),
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
    });

    const tokenResponse = await axios.post('https://discord.com/api/v10/oauth2/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token } = tokenResponse.data;

    // 2. Fetch User Profile
    const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const discordUser = userResponse.data; // { id, username, avatar, global_name }
    
    // 3. Verify Authorization list
    const allowedIdsStr = process.env.ALLOWED_DISCORD_IDS || '';
    const allowedIds = allowedIdsStr.split(',').map(id => id.trim());

    if (!allowedIds.includes(discordUser.id)) {
      return res.redirect(`${frontendUrl}/login-error?reason=unauthorized`);
    }

    // 4. Generate JWT
    const payload = {
      id: discordUser.id,
      username: discordUser.username,
      displayName: discordUser.global_name || discordUser.username,
      avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    // Redirect back to React frontend with JWT
    res.redirect(`${frontendUrl}/login-success?token=${token}`);
  } catch (error) {
    console.error('Error during Discord OAuth callback:', error.response?.data || error.message);
    res.redirect(`${frontendUrl}/login-error?reason=auth_failed`);
  }
});

// Get Current User Profile (Web Frontend)
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});


// --- WEB FRONTEND PROTECTED LOGS API ---

// GET /api/logs - Fetch all logs with filters/search
app.get('/api/logs', authenticateToken, async (req, res) => {
  const { category, search } = req.query;

  try {
    let queryBuilder = supabase.from('logs').select('*');

    if (category && category !== 'all') {
      queryBuilder = queryBuilder.eq('category', category.toLowerCase());
    }

    if (search) {
      const searchPattern = `%${search}%`;
      queryBuilder = queryBuilder.or(
        `player_name.ilike.${searchPattern},identifier.ilike.${searchPattern},details.ilike.${searchPattern},created_by.ilike.${searchPattern}`
      );
    }

    const { data: logs, error } = await queryBuilder.order('created_at', { ascending: false });
    if (error) throw error;

    // Fetch read states for these logs, handled in try-catch in case table log_read_states doesn't exist yet
    let readStates = [];
    const logIds = (logs || []).map(l => l.id);
    if (logIds.length > 0) {
      try {
        const { data: states, error: statesError } = await supabase
          .from('log_read_states')
          .select('*')
          .in('log_id', logIds);
        if (!statesError && states) {
          readStates = states;
        } else if (statesError) {
          console.warn('Warning: log_read_states table not accessible or RLS blocked. Make sure it is created in Supabase.', statesError.message);
        }
      } catch (dbErr) {
        console.warn('Warning: Could not fetch read states. Make sure log_read_states table exists.', dbErr.message);
      }
    }

    const formattedLogs = (logs || []).map(log => {
      const reads = readStates
        .filter(s => s.log_id === log.id)
        .map(s => ({
          userId: s.user_id,
          username: s.username,
          readAt: s.read_at
        }));
      return {
        ...log,
        attachments: parseJsonField(log.attachments),
        links: parseJsonField(log.links),
        readBy: reads
      };
    });

    res.json(formattedLogs);
  } catch (err) {
    console.error('Error loading logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// POST /api/logs - Manual Entry
app.post('/api/logs', authenticateToken, async (req, res) => {
  const { category, player_name, identifier, details, attachments, links } = req.body;
  const created_by = req.user.displayName || req.user.username;
  const created_at = new Date().toISOString();

  if (!category || !details) {
    return res.status(400).json({ error: 'Category and details are required' });
  }

  if (shouldSkipLog(details)) {
    return res.status(201).json({
      id: 'skipped_' + Date.now(),
      category: category.toLowerCase(),
      player_name: player_name || null,
      identifier: identifier || null,
      details,
      attachments: attachments || [],
      links: links || [],
      created_by,
      created_at
    });
  }

  try {
    const { data: newLog, error } = await supabase
      .from('logs')
      .insert({
        category: category.toLowerCase(),
        player_name: player_name || null,
        identifier: identifier || null,
        details,
        attachments: attachments || [],
        links: links || [],
        created_by,
        created_at
      })
      .select()
      .single();

    if (error) throw error;

    const formattedLog = {
      ...newLog,
      attachments: parseJsonField(newLog.attachments),
      links: parseJsonField(newLog.links)
    };

    res.status(201).json(formattedLog);
  } catch (err) {
    console.error('Error adding log:', err);
    res.status(500).json({ error: 'Failed to create log' });
  }
});

// Helper for robust GeoIP Lookup (multi-source with fallbacks)
async function getGeoIpInfo(ip) {
  // 1. Try ipwho.is (10,000 free requests/month, highly accurate)
  try {
    const res = await axios.get(`https://ipwho.is/${ip}`, { timeout: 3000 });
    if (res.data && res.data.success) {
      return {
        countryCode: res.data.country_code,
        countryName: res.data.country,
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        cityName: res.data.city || '',
        regionName: res.data.region || ''
      };
    }
  } catch (err) {
    console.warn(`ipwho.is failed for IP ${ip}: ${err.message}`);
  }

  // 2. Try ip-api.com (45 requests/minute, highly accurate but non-commercial, might be rate-limited on shared Vercel IP)
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
    if (res.data && res.data.status === 'success') {
      return {
        countryCode: res.data.countryCode,
        countryName: res.data.country,
        latitude: res.data.lat,
        longitude: res.data.lon,
        cityName: res.data.city || '',
        regionName: res.data.regionName || ''
      };
    }
  } catch (err) {
    console.warn(`ip-api.com failed for IP ${ip}: ${err.message}`);
  }

  // 3. Fallback to freeipapi.com (unlimited, less accurate but reliable fallback)
  try {
    const res = await axios.get(`https://freeipapi.com/api/json/${ip}`, { timeout: 3000 });
    if (res.data && res.data.countryCode) {
      return {
        countryCode: res.data.countryCode,
        countryName: res.data.countryName || 'Unknown',
        latitude: res.data.latitude || 0,
        longitude: res.data.longitude || 0,
        cityName: res.data.cityName || '',
        regionName: res.data.regionName || ''
      };
    }
  } catch (err) {
    console.error(`freeipapi.com fallback failed for IP ${ip}: ${err.message}`);
  }

  return null;
}

// GET /api/geoip/:ip - Proxy IP lookup to avoid client-side CORS and adblocker issues
app.get('/api/geoip/:ip', authenticateToken, async (req, res) => {
  const { ip } = req.params;
  try {
    const data = await getGeoIpInfo(ip);
    if (data) {
      res.json(data);
    } else {
      res.status(500).json({ error: 'Failed to resolve IP from all sources' });
    }
  } catch (err) {
    console.error('Failed to proxy GeoIP lookup for IP ' + ip + ':', err.message);
    res.status(500).json({ error: 'Failed to resolve IP' });
  }
});

// GET /api/map/:lat/:lon - Proxy/Serve Static Map (Mapbox, Google, or Yandex Fallback)
app.get('/api/map/:lat/:lon', async (req, res) => {
  const { lat, lon } = req.params;
  
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const geoapifyKey = process.env.GEOAPIFY_API_KEY;

  try {
    if (mapboxToken) {
      // Mapbox Static Images API (Modern Cyber Dark style matching the system)
      // Correct marker format: pin-s+06b6d4(lon,lat)
      const overlay = `pin-s+06b6d4(${lon},${lat})`;
      const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/dark-v10/static/${encodeURIComponent(overlay)}/${lon},${lat},11/500x300?access_token=${mapboxToken}`;
      
      const response = await axios.get(mapUrl, { 
        responseType: 'arraybuffer',
        headers: { Referer: 'https://fivem-loginfo.vercel.app' }
      });
      res.setHeader('Content-Type', 'image/png');
      return res.send(response.data);
    }

    if (googleKey) {
      // Google Maps Static API
      const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=11&size=500x300&markers=color:blue%7C${lat},${lon}&key=${googleKey}`;
      const response = await axios.get(mapUrl, { responseType: 'arraybuffer' });
      res.setHeader('Content-Type', 'image/png');
      return res.send(response.data);
    }

    if (geoapifyKey) {
      // Geoapify Static Map API (using OpenStreetMap style)
      const mapUrl = `https://maps.geoapify.com/v1/staticmap?style=osm-carto&width=500&height=300&center=lonlat:${lon},${lat}&zoom=11&marker=lonlat:${lon},${lat};color:%2306b6d4;size:medium&apiKey=${geoapifyKey}`;
      const response = await axios.get(mapUrl, { responseType: 'arraybuffer' });
      res.setHeader('Content-Type', 'image/png');
      return res.send(response.data);
    }
  } catch (err) {
    console.error('Failed to proxy premium map:', err.message);
    // If premium proxy fails, we will fall through to Yandex fallback redirect below
  }

  // Fallback to Yandex Static Map (Zero-config keyless fallback redirect)
  const mapUrl = `https://static-maps.yandex.ru/1.x/?ll=${lon},${lat}&z=11&l=map&size=500,300&pt=${lon},${lat},pm2gnl&lang=en_US`;
  res.redirect(mapUrl);
});

// DELETE /api/logs/:id
app.delete('/api/logs/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: log, error: fetchError } = await supabase
      .from('logs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !log) {
      return res.status(404).json({ error: 'Log not found' });
    }

    // Delete attachments from Supabase storage if they are hosted there
    if (log.attachments) {
      const attachmentsList = parseJsonField(log.attachments);
      for (const attachment of attachmentsList) {
        if (attachment.includes('/storage/v1/object/public/evidences/')) {
          const parts = attachment.split('/storage/v1/object/public/evidences/');
          const filename = parts[parts.length - 1];
          if (filename) {
            await supabase.storage.from('evidences').remove([filename]);
          }
        }
      }
    }

    const { error: deleteError } = await supabase
      .from('logs')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json({ message: 'Log deleted successfully' });
  } catch (err) {
    console.error('Error deleting log:', err);
    res.status(500).json({ error: 'Failed to delete log' });
  }
});

// PUT /api/logs/:id - Update specific log (category / details)
app.put('/api/logs/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { category, details, player_name, identifier } = req.body;

  try {
    const updateData = {};
    if (category) updateData.category = category.toLowerCase();
    if (details !== undefined) updateData.details = details;
    if (player_name !== undefined) updateData.player_name = player_name;
    if (identifier !== undefined) updateData.identifier = identifier;

    const { data: updatedLog, error } = await supabase
      .from('logs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Log updated successfully',
      log: {
        ...updatedLog,
        attachments: parseJsonField(updatedLog.attachments),
        links: parseJsonField(updatedLog.links)
      }
    });
  } catch (err) {
    console.error(`Error updating log ${id}:`, err);
    res.status(500).json({ error: 'Failed to update log' });
  }
});

// POST /api/logs/read-all - Mark all logs as read for the logged-in admin
app.post('/api/logs/read-all', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const username = req.user.displayName || req.user.username;

  try {
    // 1. Fetch all existing log IDs
    const { data: logsList, error: logsError } = await supabase
      .from('logs')
      .select('id');

    if (logsError) throw logsError;

    if (!logsList || logsList.length === 0) {
      return res.json({ success: true, message: 'No logs to mark as read' });
    }

    // 2. Prepare upsert records
    const insertData = logsList.map(log => ({
      log_id: log.id,
      user_id: userId,
      username: username
    }));

    // 3. Upsert records
    const { error: upsertError } = await supabase
      .from('log_read_states')
      .upsert(insertData, { onConflict: 'log_id,user_id' });

    if (upsertError) throw upsertError;

    res.json({ success: true });
  } catch (err) {
    console.error('Error marking all logs as read:', err);
    res.status(500).json({ error: 'Failed to mark all logs as read. Make sure public.log_read_states table is created in Supabase.' });
  }
});

// POST /api/logs/:id/read - Mark a single log as read for the logged-in admin
app.post('/api/logs/:id/read', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const username = req.user.displayName || req.user.username;

  try {
    const { data, error } = await supabase
      .from('log_read_states')
      .upsert(
        { log_id: parseInt(id), user_id: userId, username: username },
        { onConflict: 'log_id,user_id' }
      )
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error(`Error marking log ${id} as read:`, err);
    res.status(500).json({ error: 'Failed to mark log as read. Make sure public.log_read_states table is created in Supabase.' });
  }
});


// --- BOT CONNECTIVITY ENDPOINTS ---

// 1. Create Ticket
app.post('/api/bot/tickets', authenticateBot, async (req, res) => {
  const { channelId, userId, username, category } = req.body;
  const created_at = new Date().toISOString();

  if (!channelId || !userId || !username) {
    return res.status(400).json({ error: 'Missing channelId, userId or username' });
  }

  try {
    const { error } = await supabase
      .from('tickets')
      .insert({
        id: channelId,
        channel_id: channelId,
        user_id: userId,
        username: username,
        status: 'open',
        category: category || 'ticket',
        created_at: created_at
      });

    if (error) throw error;
    res.status(201).json({ message: 'Ticket registered' });
  } catch (err) {
    console.error('Error inserting ticket:', err);
    res.status(500).json({ error: 'Database error creating ticket' });
  }
});

// 2. Upload file from Bot
app.post('/api/bot/tickets/:channelId/upload', authenticateBot, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const extension = path.extname(req.file.originalname);
    const filename = `${uniqueSuffix}${extension}`;

    const { data, error } = await supabase.storage
      .from('evidences')
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      return res.status(500).json({ error: 'Failed to upload to storage' });
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('evidences')
      .getPublicUrl(filename);

    res.json({ filename: publicUrlData.publicUrl });
  } catch (err) {
    console.error('Upload handler error:', err);
    res.status(500).json({ error: 'Internal server error during upload' });
  }
});

// 3. Post Message/Evidence to Ticket Log
app.post('/api/bot/tickets/:channelId/messages', authenticateBot, async (req, res) => {
  const { channelId } = req.params;
  const { authorName, authorId, content, attachments, links, category } = req.body;
  const created_at = new Date().toISOString();

  if (shouldSkipLog(content)) {
    return res.status(201).json({ message: 'Message logged successfully (skipped storage due to close keyword)' });
  }

  try {
    // Verify ticket exists
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('*')
      .eq('channel_id', channelId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: 'Ticket channel not found' });
    }

    // Use the ticket's current selected category if available, otherwise fall back to category sent by bot
    let logCategory = ticket.category || category || 'ticket';

    const { error: insertError } = await supabase
      .from('logs')
      .insert({
        ticket_id: channelId,
        category: logCategory.toLowerCase(),
        player_name: ticket.username, // Default player name to ticket opener
        identifier: `discord:${ticket.user_id}`,
        details: content || `Sent evidence in ticket #${channelId}`,
        attachments: attachments || [],
        links: links || [],
        created_by: authorName,
        created_at: created_at
      });

    if (insertError) throw insertError;

    res.status(201).json({ message: 'Message logged successfully', category: logCategory });
  } catch (err) {
    console.error('Error logging bot ticket message:', err);
    res.status(500).json({ error: 'Failed to log message' });
  }
});

// 3.5 Update Ticket Category (Bot Selection)
app.put('/api/bot/tickets/:channelId/category', authenticateBot, async (req, res) => {
  const { channelId } = req.params;
  const { category } = req.body;

  if (!category) {
    return res.status(400).json({ error: 'Category is required' });
  }

  try {
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('*')
      .eq('channel_id', channelId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: 'Ticket channel not found' });
    }

    const { error: updateError } = await supabase
      .from('tickets')
      .update({ category: category.toLowerCase() })
      .eq('channel_id', channelId);

    if (updateError) throw updateError;

    // Also update all existing logs of this ticket to the new category
    const { error: logsUpdateError } = await supabase
      .from('logs')
      .update({ category: category.toLowerCase() })
      .eq('ticket_id', channelId);

    if (logsUpdateError) {
      console.error('Failed to update existing logs categories:', logsUpdateError);
    }

    res.json({ message: 'Ticket category updated successfully', category });
  } catch (err) {
    console.error('Error updating ticket category:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// 4. Close Ticket & generate final report summary
app.put('/api/bot/tickets/:channelId/close', authenticateBot, async (req, res) => {
  const { channelId } = req.params;
  const { closedBy } = req.body;
  const closed_at = new Date().toISOString();

  try {
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('*')
      .eq('channel_id', channelId)
      .eq('status', 'open')
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: 'Open ticket not found' });
    }

    // Update ticket status
    const { error: updateError } = await supabase
      .from('tickets')
      .update({ status: 'closed', closed_at: closed_at })
      .eq('id', channelId);

    if (updateError) throw updateError;

    // Retrieve all logs for this ticket to build final report
    const { data: ticketLogs, error: logsError } = await supabase
      .from('logs')
      .select('*')
      .eq('ticket_id', channelId)
      .order('created_at', { ascending: true });

    if (logsError) throw logsError;
    
    res.json({ 
      message: 'Ticket closed successfully',
      ticketId: channelId,
      logCount: (ticketLogs || []).length 
    });
  } catch (err) {
    console.error('Error closing ticket:', err);
    res.status(500).json({ error: 'Failed to close ticket' });
  }
});

// Run server
app.listen(PORT, () => {
  console.log(`Express Backend running on port ${PORT}`);
});
