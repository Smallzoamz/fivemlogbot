import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Plus, 
  Copy, 
  Trash2, 
  LogOut, 
  Database, 
  Ticket, 
  AlertTriangle, 
  Ban, 
  FileText, 
  Image as ImageIcon,
  ExternalLink,
  Check,
  User as UserIcon,
  Shield,
  Globe,
  Play
} from 'lucide-react';

// Helper: Extract a short display name from a long URL
const getShortFileName = (url, index) => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    const extMatch = lastSegment.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|mov|avi|pdf)$/i);
    const ext = extMatch ? extMatch[0] : '.png';
    return `image${String(index + 1).padStart(2, '0')}${ext}`;
  } catch {
    return `file${String(index + 1).padStart(2, '0')}`;
  }
};

// Helper: Check if a log's details/content indicate a closed ticket message to filter it out
const shouldSkipLog = (text) => {
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
};

// Helper: Extract IP address from fields or text
const extractIpAddress = (log, playerFields, otherFields) => {
  const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
  
  for (const f of otherFields) {
    const match = f.value.match(ipRegex);
    if (match) return match[0];
  }
  for (const f of playerFields) {
    const match = f.value.match(ipRegex);
    if (match) return match[0];
  }
  if (log.details) {
    const match = log.details.match(ipRegex);
    if (match) return match[0];
  }
  if (log.identifier) {
    const match = log.identifier.match(ipRegex);
    if (match) return match[0];
  }
  return null;
};

// Helper: Render text with long URLs replaced by short clickable links
const RichDescription = ({ text }) => {
  if (!text) return null;
  
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlPattern);
  
  let urlCounter = 0;
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      const shortName = getShortFileName(part, urlCounter);
      urlCounter++;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="inline-image-link"
          title={part}
        >
          📷 {shortName}
        </a>
      );
    }
    // Preserve newlines in non-URL parts
    return part.split('\n').map((line, j, arr) => (
      <React.Fragment key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </React.Fragment>
    ));
  });
};

// Parse details text to extract unstructured description and fields
const parseLogDetails = (detailsText) => {
  if (!detailsText) return { description: '', fields: [] };
  
  const lines = detailsText.split('\n');
  const descriptionLines = [];
  const fields = [];
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    // Look for separator, e.g. "Nameplayer : value" or "Discord: value"
    // Let's support both colon and space-colon-space
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0 && colonIndex < trimmed.length - 1) {
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      
      // Let's make sure it's a valid key-value. A valid key shouldn't be too long, e.g. < 40 chars
      // Also prevent URL matching since URLs contain "https://"
      if (key.length < 40 && !key.toLowerCase().includes('http') && !key.toLowerCase().includes('https')) {
        fields.push({ key, value });
        return;
      }
    }
    
    descriptionLines.push(trimmed);
  });
  
  return {
    description: descriptionLines.join('\n'),
    fields
  };
};

const getFormattedFields = (log) => {
  const { description, fields } = parseLogDetails(log.details);
  const finalFields = [...fields];
  
  // Tag fields parsed from details that represent reporter
  const reporterKeyPatterns = [
    'ผู้แจ้ง',
    'ชื่อเคส/ผู้แจ้ง',
    'ชื่อเคส / ผู้แจ้ง',
    'ผู้เปิดเคส',
    'discord id ผู้แจ้ง',
    'id discord ของผู้แจ้ง',
    'discord ของผู้แจ้ง',
    'reporter'
  ];
  
  finalFields.forEach(f => {
    const lowerKey = f.key.toLowerCase();
    if (reporterKeyPatterns.some(pattern => lowerKey === pattern || lowerKey.includes(pattern))) {
      f.isReporter = true;
    }
  });
  
  // Check if player_name needs to be injected
  const hasPlayerName = finalFields.some(f => {
    const k = f.key.toLowerCase();
    return k === 'player' || k === 'player name' || k === 'nameplayer' || k === 'ผู้เล่น' || k === 'ชื่อผู้เล่น';
  });
  if (!hasPlayerName && log.player_name) {
    const keyLabel = log.ticket_id ? 'ผู้แจ้ง' : 'ผู้เล่น';
    finalFields.unshift({ key: keyLabel, value: log.player_name, isReporter: !!log.ticket_id });
  }
  
  // Check if identifier needs to be injected
  const hasIdentifier = finalFields.some(f => {
    const k = f.key.toLowerCase();
    return k === 'identifier' || k === 'id/hex' || k === 'hex' || k === 'discord id' || k === 'steam hex' || k === 'steam id';
  });
  if (!hasIdentifier && log.identifier) {
    const keyLabel = log.ticket_id ? 'Discord ID ผู้แจ้ง' : 'ID/Hex';
    finalFields.push({ key: keyLabel, value: log.identifier, isReporter: !!log.ticket_id });
  }

  // Separate player-related fields from others
  const playerInfoKeys = [
    'discord', 'discord id', 'steam id', 'steam hex', 'license', 'license (1)', 'license (2)', 
    'ip address', 'identifier', 'id/hex', 'hex', 'ผู้เล่น', 'player', 'player name', 'nameplayer', 'ชื่อผู้เล่น', 'ผู้แจ้ง', 'discord id ผู้แจ้ง'
  ];
  
  const playerFields = [];
  const otherFields = [];
  
  finalFields.forEach(f => {
    const lowerKey = f.key.toLowerCase();
    if (playerInfoKeys.some(k => lowerKey === k || lowerKey.includes(k))) {
      playerFields.push(f);
    } else {
      otherFields.push(f);
    }
  });

  return {
    description,
    playerFields,
    otherFields
  };
};

// Helper: Detect and parse video links (Google Drive, YouTube, direct video files)
const getVideoInfo = (url) => {
  if (!url) return null;
  
  // 1. Google Drive
  if (url.includes('drive.google.com') && (url.includes('/file/d/') || url.includes('id='))) {
    let fileId = '';
    const matchD = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (matchD) {
      fileId = matchD[1];
    } else {
      const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (matchId) {
        fileId = matchId[1];
      }
    }
    if (fileId) {
      return {
        type: 'drive',
        embedUrl: `https://drive.google.com/file/d/${fileId}/preview`
      };
    }
  }

  // 2. YouTube
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    let videoId = '';
    const matchV = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (matchV) {
      videoId = matchV[1];
    } else {
      const matchShort = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
      if (matchShort) {
        videoId = matchShort[1];
      } else {
        const matchEmbed = url.match(/\/embed\/([a-zA-Z0-9_-]+)/);
        if (matchEmbed) {
          videoId = matchEmbed[1];
        }
      }
    }
    if (videoId) {
      return {
        type: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`
      };
    }
  }

  // 3. Direct video file
  if (/\.(mp4|webm|ogg|mov)$/i.test(url) || (url.includes('cdn.discordapp.com/attachments/') && url.includes('.mp4'))) {
    return {
      type: 'direct',
      embedUrl: url
    };
  }

  return null;
};

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(!!(localStorage.getItem('token') || ''));
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState(['ticket', 'evidence', 'ban', 'warning', 'note', 'inter_register']);
  const [ipCountries, setIpCountries] = useState({});
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLog, setNewLog] = useState({
    category: 'note',
    player_name: '',
    identifier: '',
    details: '',
    attachments: '',
    links: ''
  });

  // Success message state (for Copy button)
  const [copiedId, setCopiedId] = useState(null);
  const [copiedValue, setCopiedValue] = useState(null);
  const [copiedPlayerGroupId, setCopiedPlayerGroupId] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewVideo, setPreviewVideo] = useState(null);

  // Update categories set from logs list dynamically
  useEffect(() => {
    if (logs.length > 0) {
      const logCats = logs.map(log => log.category.toLowerCase());
      setCategories(prev => Array.from(new Set([...prev, ...logCats])).filter(Boolean));
    }
  }, [logs]);

  // Parse token from URL callback if present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    
    if (urlToken) {
      localStorage.setItem('token', urlToken);
      setToken(urlToken);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Fetch User profile
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoadingUser(false);
      return;
    }

    setLoadingUser(true);
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Session expired');
        return res.json();
      })
      .then(data => {
        setUser(data.user);
      })
      .catch(err => {
        console.error(err);
        handleLogout();
      })
      .finally(() => {
        setLoadingUser(false);
      });
  }, [token]);

  // Fetch logs list & setup polling for real-time updates
  useEffect(() => {
    if (!token) return;

    fetchLogs();

    const interval = setInterval(() => {
      let url = `/api/logs?category=${categoryFilter}`;
      if (searchQuery) {
        url += `&search=${encodeURIComponent(searchQuery)}`;
      }

      fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            const filtered = data.filter(log => !shouldSkipLog(log.details));
            setLogs(filtered);
            resolveIps(filtered);
          }
        })
        .catch(err => console.error('Error polling logs:', err));
    }, 5000);

    return () => clearInterval(interval);
  }, [token, categoryFilter, searchQuery]);

  const resolveIps = async (logsList) => {
    const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
    const uniqueIps = new Set();
    
    logsList.forEach(log => {
      let match = log.details ? log.details.match(ipRegex) : null;
      if (match) {
        uniqueIps.add(match[0]);
      }
      if (log.identifier) {
        match = log.identifier.match(ipRegex);
        if (match) uniqueIps.add(match[0]);
      }
    });

    for (const ip of uniqueIps) {
      if (ipCountries[ip]) continue;
      
      try {
        const res = await fetch(`/api/geoip/${ip}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data && data.countryCode) {
          setIpCountries(prev => ({
            ...prev,
            [ip]: {
              countryCode: data.countryCode,
              country: data.countryName || 'Unknown',
              lat: data.latitude || 0,
              lon: data.longitude || 0,
              city: data.cityName || ''
            }
          }));
        }
      } catch (err) {
        console.error('GeoIP fetch failed for IP ' + ip, err);
      }
    }
  };

  const fetchLogs = () => {
    setLoading(true);
    let url = `/api/logs?category=${categoryFilter}`;
    if (searchQuery) {
      url += `&search=${encodeURIComponent(searchQuery)}`;
    }

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const filtered = data.filter(log => !shouldSkipLog(log.details));
          setLogs(filtered);
          resolveIps(filtered);
        }
      })
      .catch(err => console.error('Error fetching logs:', err))
      .finally(() => setLoading(false));
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
  };

  const handleAddLog = (e) => {
    e.preventDefault();
    if (!newLog.details.trim()) return;

    const body = {
      category: newLog.category,
      player_name: newLog.player_name || null,
      identifier: newLog.identifier || null,
      details: newLog.details,
      attachments: newLog.attachments ? newLog.attachments.split(',').map(s => s.trim()) : [],
      links: newLog.links ? newLog.links.split(',').map(s => s.trim()) : []
    };

    fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    })
      .then(res => res.json())
      .then(data => {
        if (!shouldSkipLog(data.details)) {
          setLogs([data, ...logs]);
          resolveIps([data]);
        }
        setShowAddModal(false);
        setNewLog({
          category: 'note',
          player_name: '',
          identifier: '',
          details: '',
          attachments: '',
          links: ''
        });
      })
      .catch(err => console.error('Error adding log:', err));
  };

  const handleCategoryChange = (cat) => {
    setNewLog(prev => {
      let detailsVal = prev.details;
      if (cat === 'inter_register') {
        detailsVal = `ประเทศที่เล่น : \nรัฐที่อยู่ : \nID Discord : \nชื่อ-นามสกุล IC ผู้เล่น : \nการหา Server IP(IPv4): \n[ แนบรูปที่อยู่บนMap ]`;
      } else if (prev.category === 'inter_register' && prev.details.startsWith('ประเทศที่เล่น :')) {
        detailsVal = '';
      }
      return {
        ...prev,
        category: cat,
        details: detailsVal
      };
    });
  };

  const handleDeleteLog = (id) => {
    if (!window.confirm('คุณต้องการลบบันทึกข้อมูลรายการนี้ใช่หรือไม่?')) return;

    fetch(`/api/logs/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (res.ok) {
          setLogs(logs.filter(log => log.id !== id));
        }
      })
      .catch(err => console.error('Error deleting log:', err));
  };
  
  const handleCopyValue = (value, e) => {
    e.stopPropagation();
    if (!value) return;
    
    // Strip discord markup tags like <@914812722741399633> to just the raw value if copied
    const cleanValue = value.startsWith('<@') && value.endsWith('>') 
      ? value.substring(2, value.length - 1) 
      : value;
      
    navigator.clipboard.writeText(cleanValue)
      .then(() => {
        setCopiedValue(value);
        setTimeout(() => setCopiedValue(null), 1500);
      })
      .catch(err => console.error('Failed to copy value:', err));
  };

  const handleCopyPlayerGroup = (fields, logId, e) => {
    e.stopPropagation();
    if (!fields || fields.length === 0) return;
    
    const textToCopy = fields.map(f => `${f.key}: ${f.value}`).join('\n');
    navigator.clipboard.writeText(textToCopy)
      .then(() => {
        setCopiedPlayerGroupId(logId);
        setTimeout(() => setCopiedPlayerGroupId(null), 2000);
      })
      .catch(err => console.error('Failed to copy player group:', err));
  };

  // Convert log details to Discord format & Copy
  const copyToDiscord = (log) => {
    const { description, playerFields, otherFields } = getFormattedFields(log);

    const ip = extractIpAddress(log, playerFields, otherFields);
    const ipInfo = ip ? ipCountries[ip] : null;
    const cat = log.category.toLowerCase();

    const evidenceLinks = [];
    const seenUrls = new Set();
    let imageCounter = 0;
    let clipCounter = 0;
    let fileCounter = 0;

    const addUrl = (url) => {
      if (!url) return;
      const normalized = url.trim();
      if (seenUrls.has(normalized)) return;
      seenUrls.add(normalized);

      let shortName = '';
      try {
        const urlObj = new URL(normalized);
        const pathname = urlObj.pathname.toLowerCase();
        
        // Differentiate clip/video links
        const isVideo = /\.(mp4|webm|mov|mkv|avi|wmv)$/i.test(pathname) || 
                        /youtube\.com|youtu\.be|twitch\.tv|medal\.tv|tiktok\.com/i.test(urlObj.hostname) ||
                        (urlObj.hostname.includes('drive.google.com') && urlObj.pathname.includes('/file/'));

        if (isVideo) {
          const extMatch = pathname.match(/\.(mp4|webm|mov|mkv|avi|wmv)$/i);
          const ext = extMatch ? extMatch[0] : '.mp4';
          shortName = `clip${String(clipCounter + 1).padStart(2, '0')}${ext}`;
          clipCounter++;
        } else {
          // Differentiate images (Supabase, local uploads, or file extension)
          const isImage = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(pathname) ||
                          urlObj.hostname.includes('supabase') ||
                          pathname.includes('/uploads/');
          
          if (isImage) {
            const extMatch = pathname.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i);
            const ext = extMatch ? extMatch[0] : '.png';
            shortName = `image${String(imageCounter + 1).padStart(2, '0')}${ext}`;
            imageCounter++;
          } else {
            const extMatch = pathname.match(/\.[a-z0-9]+$/i);
            const ext = extMatch ? extMatch[0] : '.bin';
            shortName = `file${String(fileCounter + 1).padStart(2, '0')}${ext}`;
            fileCounter++;
          }
        }
      } catch {
        shortName = `file${String(fileCounter + 1).padStart(2, '0')}`;
        fileCounter++;
      }

      evidenceLinks.push({ shortName, url: normalized });
    };

    // 1. Extract URLs from description
    if (description) {
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      const descMatches = description.match(urlPattern);
      if (descMatches) {
        descMatches.forEach(match => {
          addUrl(match);
        });
      }
    }

    // 2. Extract URLs from other fields
    const filteredOtherFields = otherFields.filter(f => !f.isReporter);
    filteredOtherFields.forEach(f => {
      const hasUrl = /https?:\/\//.test(f.value);
      if (hasUrl) {
        addUrl(f.value);
      }
    });

    // 3. Extract attachments
    if (log.attachments && log.attachments.length > 0) {
      log.attachments.forEach((att) => {
        const url = att.startsWith('http') ? att : `${window.location.origin}/uploads/${att}`;
        addUrl(url);
      });
    }

    // 4. Extract reference links
    if (log.links && log.links.length > 0) {
      log.links.forEach((link) => {
        addUrl(link);
      });
    }

    let evidenceLines = '';
    if (evidenceLinks.length > 0) {
      evidenceLines += `\n📷 **หลักฐาน:**\n`;
      evidenceLinks.forEach(item => {
        evidenceLines += `[${item.shortName}](${item.url})\n`;
      });
    }

    // Custom formatting for inter_register (International Registration)
    if (cat === 'inter_register') {
      const typeLabel = `✈️ **ประกาศลงทะเบียนผู้เล่นต่างประเทศ** ✈️`;
      const detailsBlock = `\`\`\`\n${log.details.trim()}\n\`\`\`\n`;
      
      let mapLine = '';
      if (ipInfo && ipInfo.lat && ipInfo.lon) {
        const cleanHost = window.location.origin;
        const shortMapUrl = `${cleanHost}/api/map/${ipInfo.lat}/${ipInfo.lon}`;
        mapLine = `\n📍 **แผนที่พิกัดประเทศผู้เล่น (Verified IP Location):**\n${shortMapUrl}\n`;
      }
      
      const finalMsgText = `${typeLabel}\n${detailsBlock}${evidenceLines}${mapLine}`;

      navigator.clipboard.writeText(finalMsgText)
        .then(() => {
          setCopiedId(log.id);
          setTimeout(() => setCopiedId(null), 2000);
        })
        .catch(err => console.error('Failed to copy text: ', err));
      return;
    }

    let playerContent = '';
    const filteredPlayerFields = playerFields.filter(f => !f.isReporter);
    if (filteredPlayerFields.length > 0) {
      let playerText = '';
      filteredPlayerFields.forEach(f => {
        playerText += `${f.key}: ${f.value}\n`;
      });
      playerContent = `\n**[PLAYER INFORMATION]**\n\`\`\`\n${playerText.trim()}\n\`\`\`\n`;
    }

    let reasonContent = '';
    const reasonField = otherFields.find(f => {
      const lowerKey = f.key.toLowerCase();
      return lowerKey === 'reason' || lowerKey.includes('เหตุผล');
    });
    if (reasonField) {
      reasonContent = `\n**[REASON / เหตุผล]**\n\`\`\`\n${reasonField.value.trim()}\n\`\`\`\n`;
    }

    let typeLabel = '';
    
    if (cat === 'ban' || cat.includes('แดง') || cat.includes('red')) {
      typeLabel = `🟥 **ประกาศใบแดง** 🟥`;
    } else if (cat.includes('ส้ม') || cat.includes('orange')) {
      typeLabel = `🟧 **ประกาศใบส้ม** 🟧`;
    } else if (cat === 'warning' || cat.includes('เหลือง') || cat.includes('yellow')) {
      typeLabel = `🟨 **ประกาศใบเหลือง** 🟨`;
    } else {
      const labelEmoji = log.category === 'evidence' ? '📷' : '📝';
      const fallbackLabel = log.category === 'evidence' ? 'EVIDENCE LOG / หลักฐานเคส' : 'LOG / บันทึก';
      typeLabel = `${labelEmoji} **[${fallbackLabel}]**`;
    }

    const finalMsgText = `${typeLabel}
${playerContent}${reasonContent}${evidenceLines}`;

    navigator.clipboard.writeText(finalMsgText)
      .then(() => {
        setCopiedId(log.id);
        setTimeout(() => setCopiedId(null), 2000);
      })
      .catch(err => console.error('Failed to copy text: ', err));
  };

  // Helper icons and styles based on category
  const getCategoryStyles = (category) => {
    switch (category) {
      case 'ban':
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          border: 'rgba(239, 68, 68, 0.4)',
          text: '#ef4444',
          glow: 'rgba(239, 68, 68, 0.3)',
          icon: <Ban className="w-4 h-4 text-red-500" />
        };
      case 'warning':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          border: 'rgba(245, 158, 11, 0.4)',
          text: '#f59e0b',
          glow: 'rgba(245, 158, 11, 0.3)',
          icon: <AlertTriangle className="w-4 h-4 text-amber-500" />
        };
      case 'ticket':
        return {
          bg: 'rgba(59, 130, 246, 0.15)',
          border: 'rgba(59, 130, 246, 0.4)',
          text: '#3b82f6',
          glow: 'rgba(59, 130, 246, 0.3)',
          icon: <Ticket className="w-4 h-4 text-blue-500" />
        };
      case 'evidence':
        return {
          bg: 'rgba(168, 85, 247, 0.15)',
          border: 'rgba(168, 85, 247, 0.4)',
          text: '#a855f7',
          glow: 'rgba(168, 85, 247, 0.3)',
          icon: <ImageIcon className="w-4 h-4 text-purple-500" />
        };
      case 'bug_report':
        return {
          bg: 'rgba(236, 72, 153, 0.15)',
          border: 'rgba(236, 72, 153, 0.4)',
          text: '#ec4899',
          glow: 'rgba(236, 72, 153, 0.3)',
          icon: <AlertTriangle className="w-4 h-4 text-pink-500" />
        };
      case 'donation':
        return {
          bg: 'rgba(234, 179, 8, 0.15)',
          border: 'rgba(234, 179, 8, 0.4)',
          text: '#eab308',
          glow: 'rgba(234, 179, 8, 0.3)',
          icon: <Database className="w-4 h-4 text-yellow-500" />
        };
      case 'inter_register':
        return {
          bg: 'rgba(16, 185, 129, 0.15)',
          border: 'rgba(16, 185, 129, 0.4)',
          text: '#10b981',
          glow: 'rgba(16, 185, 129, 0.3)',
          icon: <Globe className="w-4 h-4 text-emerald-500" />
        };
      default:
        return {
          bg: 'rgba(16, 185, 129, 0.15)',
          border: 'rgba(16, 185, 129, 0.4)',
          text: '#10b981',
          glow: 'rgba(16, 185, 129, 0.3)',
          icon: <FileText className="w-4 h-4 text-emerald-500" />
        };
    }
  };

  // Helper to translate categories to beautiful labels
  const getCategoryLabel = (cat) => {
    switch (cat) {
      case 'all': return 'ทั้งหมด';
      case 'ticket': return '🎫 ตั๋วเคส';
      case 'evidence': return '📷 รูปหลักฐาน';
      case 'ban': return '🚨 แบนผู้เล่น';
      case 'warning': return '⚠️ เตือนผู้เล่น';
      case 'note': return '📝 บันทึกทั่วไป';
      case 'bug_report': return '🐛 บั๊กระบบ';
      case 'donation': return '💎 เติมเงิน / โดเนท';
      case 'inter_register': return '✈️ ลงทะเบียนต่างประเทศ';
      default:
        // Capitalize custom category names nicely
        const cleanName = cat.replace(/_/g, ' ');
        return `📂 ${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`;
    }
  };

  // Loading State during session validation
  if (token && loadingUser) {
    return (
      <div className="login-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '15px' }}>
        <div className="glow-logo">
          <Shield className="w-12 h-12 text-neon-cyan animate-pulse" />
        </div>
        <p style={{ color: '#00ff87', fontSize: '18px', fontWeight: '500', textShadow: '0 0 10px rgba(0,255,135,0.4)' }}>
          กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...
        </p>
      </div>
    );
  }

  // Login Screen
  if (!token || !user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="glow-logo">
              <Shield className="w-12 h-12 text-neon-cyan animate-pulse" />
            </div>
            <h1>FiveM Admin Log & Ticket Console</h1>
            <p className="subtitle">ระบบบันทึกและสืบค้นข้อมูลแอดมินหลังบ้าน</p>
          </div>
          
          <div className="login-body">
            <div className="feature-item">
              <Ticket className="w-5 h-5 text-neon-pink" />
              <span>ซิงค์ข้อมูล Ticket บันทึกรูปภาพและแชทในดิสคอร์ดเข้าสู่ฐานข้อมูลโดยตรง</span>
            </div>
            <div className="feature-item">
              <Search className="w-5 h-5 text-neon-cyan" />
              <span>ค้นหาข้อมูลผู้เล่น ประวัติการลงโทษ ย้อนหลังได้ทันใจในเสี้ยววินาที</span>
            </div>
            <div className="feature-item">
              <Copy className="w-5 h-5 text-neon-green" />
              <span>คลิกเดียวคัดลอกประวัติฟอร์แมตดิสคอร์ดพร้อมนำไปส่งต่อได้ทันที</span>
            </div>

            <a href="/api/auth/discord/login" className="login-button">
              <svg className="w-6 h-6 mr-2 fill-current" viewBox="0 0 127.14 96.36">
                <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.4-5c.87-.64,1.71-1.32,2.51-2a75.48,75.48,0,0,0,72.76,0c.8,0.72,1.64,1.4,2.51,2a68.43,68.43,0,0,1-10.4,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.87,48.24,123.51,25.43,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.88,46,53.88,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.12,46,96.12,53,91,65.69,84.69,65.69Z" />
              </svg>
              เข้าสู่ระบบด้วย Discord
            </a>
          </div>
          <div className="login-footer">
            <span>Admin Control Panel &copy; {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    );
  }

  // Calculate Statistics
  const getStats = () => {
    return {
      total: logs.length,
      tickets: logs.filter(l => l.category === 'ticket' || l.category === 'evidence').length,
      bans: logs.filter(l => l.category === 'ban').length,
      warnings: logs.filter(l => l.category === 'warning').length
    };
  };

  const stats = getStats();

  return (
    <div className="dashboard-container">
      {/* HEADER NAVBAR */}
      <header className="navbar">
        <div className="navbar-logo">
          <Database className="w-6 h-6 text-neon-cyan" />
          <h2>FIVEM ADMIN HUB</h2>
        </div>

        {user && (
          <div className="navbar-profile">
            <div className="user-info">
              {user.avatar ? (
                <img src={user.avatar} alt={user.displayName} className="avatar-img" />
              ) : (
                <div className="avatar-fallback"><UserIcon className="w-4 h-4" /></div>
              )}
              <span className="username">{user.displayName}</span>
            </div>
            <button onClick={handleLogout} className="btn-logout" title="ออกจากระบบ">
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        )}
      </header>

      {/* DASHBOARD CONTENT */}
      <main className="content">
        
        {/* STATS TILES */}
        <section className="stats-row">
          <div className="stat-card total">
            <h3>LOGS ทั้งหมด</h3>
            <span className="stat-value">{stats.total}</span>
          </div>
          <div className="stat-card ticket">
            <h3>ตั๋ว / หลักฐาน</h3>
            <span className="stat-value">{stats.tickets}</span>
          </div>
          <div className="stat-card ban">
            <h3>ประวัติแบน</h3>
            <span className="stat-value">{stats.bans}</span>
          </div>
          <div className="stat-card warning">
            <h3>ประวัติการแจ้งเตือน</h3>
            <span className="stat-value">{stats.warnings}</span>
          </div>
        </section>

        {/* CONTROLS (SEARCH & MANAGE) */}
        <section className="controls-row">
          <div className="search-box">
            <Search className="w-5 h-5 text-gray-400" />
            <input 
              type="text" 
              placeholder="ค้นหาชื่อผู้เล่น, Hex, รายละเอียด, แอดมิน..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <button onClick={() => setShowAddModal(true)} className="btn-primary">
            <Plus className="w-5 h-5 mr-1" />
            เพิ่มบันทึกเอง
          </button>
        </section>

        {/* CATEGORY TABS */}
        <section className="tabs-row">
          <button 
            className={`tab ${categoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            ทั้งหมด
          </button>
          {categories.map(cat => (
            <button 
              key={cat}
              className={`tab ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {getCategoryLabel(cat)}
            </button>
          ))}
        </section>

        {/* FEED / LIST OF LOGS */}
        <section className="logs-feed">
          {loading ? (
            <div className="loading-state">กำลังโหลดข้อมูล...</div>
          ) : logs.length === 0 ? (
            <div className="empty-state">ไม่พบประวัติการบันทึกข้อมูลตามที่ระบุ</div>
          ) : (
            logs.map(log => {
              const styles = getCategoryStyles(log.category);
              const { description, playerFields, otherFields } = getFormattedFields(log);
              const ip = extractIpAddress(log, playerFields, otherFields);
              const ipInfo = ip ? ipCountries[ip] : null;
              const isForeignIP = ipInfo && ipInfo.countryCode && ipInfo.countryCode !== 'TH';

              // Format date & time
              const logDate = new Date(log.created_at);
              const day = String(logDate.getDate()).padStart(2, '0');
              const month = String(logDate.getMonth() + 1).padStart(2, '0');
              const year = logDate.getFullYear();
              const dateStr = `${day}/${month}/${year}`;

              const hours = String(logDate.getHours()).padStart(2, '0');
              const minutes = String(logDate.getMinutes()).padStart(2, '0');
              const seconds = String(logDate.getSeconds()).padStart(2, '0');
              const timeStr = `${hours}:${minutes}:${seconds}`;

              return (
                <div 
                  key={log.id} 
                  className="discord-message"
                >
                  {/* MESSAGE HEADER */}
                  <div className="discord-message-header">
                    <div className="admin-avatar">
                      <Shield className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="admin-meta">
                      <span className="admin-name">แอดมิน: <strong>{log.created_by}</strong></span>
                      <span className="message-timestamp">
                        {new Date(log.created_at).toLocaleString('th-TH')}
                      </span>
                    </div>
                  </div>

                  {/* DISCORD EMBED */}
                  <div className="discord-embed" style={{ borderLeftColor: styles.text }}>
                    {log.category.toLowerCase() === 'inter_register' && isForeignIP && (
                      <div className="foreign-ip-verified-badge" title={`IP: ${ip} (Country: ${ipInfo.country})`}>
                        <Globe className="w-3.5 h-3.5 mr-1 text-emerald-400 animate-pulse" />
                        <span>ต่างประเทศจริง ({ipInfo.country})</span>
                      </div>
                    )}
                    
                    <div className="embed-content-wrapper">
                      <div className="embed-left-side">
                        {/* EMBED HEADER */}
                        <div className="embed-header">
                          <div className="embed-badge-icon" style={{ color: styles.text }}>
                            {styles.icon}
                          </div>
                          <span className="embed-category-title">{log.category.toUpperCase()}</span>
                        </div>

                        {/* EMBED DESCRIPTION */}
                        {description && (
                          <div className="embed-description">
                            <RichDescription text={description} />
                          </div>
                        )}

                        {/* EMBED MAP FOR INTER REGISTER */}
                        {log.category.toLowerCase() === 'inter_register' && ipInfo && ipInfo.lat && ipInfo.lon && (
                          <div className="embed-map-container">
                            <div className="embed-map-header">
                              <Globe className="w-3.5 h-3.5 mr-1 text-neon-cyan" />
                              <span>Verified IP Geo-Location: {ipInfo.city ? `${ipInfo.city}, ` : ''}{ipInfo.country}</span>
                            </div>
                            <div className="embed-map-wrapper">
                              <img 
                                src={`https://static-maps.yandex.ru/1.x/?ll=${ipInfo.lon},${ipInfo.lat}&z=7&l=map&size=500,280&pt=${ipInfo.lon},${ipInfo.lat},pm2gnl&lang=en_US`} 
                                alt="Player Location Map" 
                                className="embed-map-img" 
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* EMBED FIELDS */}
                    <div className="embed-fields">
                      {/* Other Fields */}
                      {otherFields.map((field, idx) => {
                        const isCopied = copiedValue === field.value;
                        const hasUrl = /https?:\/\//.test(field.value);
                        return (
                          <div key={idx} className="embed-field-box">
                            <div className="field-label">{field.key.toUpperCase()}</div>
                            <div 
                              className={`field-value copyable-value ${isCopied ? 'copied' : ''}`}
                              onClick={(e) => handleCopyValue(field.value, e)}
                              title="คลิกเพื่อคัดลอกเฉพาะข้อมูลส่วนนี้"
                            >
                              {hasUrl ? <RichDescription text={field.value} /> : field.value}
                              {isCopied && <span className="copy-indicator">คัดลอกแล้ว!</span>}
                            </div>
                          </div>
                        );
                      })}

                      {/* Player Info Grouped */}
                      {playerFields.filter(f => !f.isReporter).length > 0 && (
                        <div className="embed-field-box player-info-group">
                          <div className="player-info-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <div className="field-label" style={{ marginBottom: 0 }}>PLAYER INFORMATION</div>
                            <button 
                              className={`btn-copy-player-group ${copiedPlayerGroupId === log.id ? 'copied' : ''}`}
                              onClick={(e) => handleCopyPlayerGroup(playerFields.filter(f => !f.isReporter), log.id, e)}
                              title="คัดลอกข้อมูลผู้เล่นทั้งหมดในกรอบนี้"
                            >
                              {copiedPlayerGroupId === log.id ? (
                                <>
                                  <Check className="w-3 h-3 mr-1" />
                                  <span>คัดลอกแล้ว!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 mr-1" />
                                  <span>คัดลอกทั้งหมด</span>
                                </>
                              )}
                            </button>
                          </div>
                          <div className="player-info-list">
                            {playerFields.filter(f => !f.isReporter).map((field, idx) => {
                              const isCopied = copiedValue === field.value;
                              return (
                                <div key={idx} className="player-info-row">
                                  <span className="player-info-key">{field.key}:</span>
                                  <span 
                                    className={`player-info-value copyable-value ${isCopied ? 'copied' : ''}`}
                                    onClick={(e) => handleCopyValue(field.value, e)}
                                    title="คลิกเพื่อคัดลอกเฉพาะข้อมูลส่วนนี้"
                                  >
                                    {field.value}
                                    {isCopied && <span className="copy-indicator">คัดลอกแล้ว!</span>}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Date & Time Grid */}
                      <div className="embed-grid-cols-2">
                        <div className="embed-field-box">
                          <div className="field-label">DATE (LOCAL)</div>
                          <div 
                            className={`field-value copyable-value ${copiedValue === dateStr ? 'copied' : ''}`}
                            onClick={(e) => handleCopyValue(dateStr, e)}
                            title="คลิกเพื่อคัดลอกวันที่"
                          >
                            {dateStr}
                            {copiedValue === dateStr && <span className="copy-indicator">คัดลอกแล้ว!</span>}
                          </div>
                        </div>
                        <div className="embed-field-box">
                          <div className="field-label">TIME (LOCAL)</div>
                          <div 
                            className={`field-value copyable-value ${copiedValue === timeStr ? 'copied' : ''}`}
                            onClick={(e) => handleCopyValue(timeStr, e)}
                            title="คลิกเพื่อคัดลอกเวลา"
                          >
                            {timeStr}
                            {copiedValue === timeStr && <span className="copy-indicator">คัดลอกแล้ว!</span>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* IMAGES GRID */}
                    {log.attachments && log.attachments.length > 0 && (
                      <div className="embed-attachments">
                        <div className="embed-attachments-title">ไฟล์ภาพหลักฐาน:</div>
                        <div className="embed-images-grid">
                          {log.attachments.map((file, idx) => {
                            const imageUrl = file.startsWith('http') ? file : `/uploads/${file}`;
                            return (
                              <div 
                                key={idx} 
                                onClick={(e) => {
                                  e.preventDefault();
                                  setPreviewImage(imageUrl);
                                }}
                                className="embed-image-card"
                              >
                                <img src={imageUrl} alt="evidence-thumb" className="embed-small-image" />
                                <div className="embed-image-card-overlay">
                                  <ExternalLink className="w-4 h-4 text-white" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* LINKS */}
                    {log.links && log.links.length > 0 && (
                      <div className="embed-links">
                        <div className="embed-attachments-title">ลิงก์แนบ:</div>
                        <div className="embed-links-row">
                          {log.links.map((link, idx) => {
                            const videoInfo = getVideoInfo(link);
                            if (videoInfo) {
                              return (
                                <button 
                                  key={idx} 
                                  onClick={() => setPreviewVideo(videoInfo)}
                                  className="embed-btn-link video-link"
                                  type="button"
                                >
                                  <Play className="w-3 h-3 mr-1" />
                                  {link.length > 35 ? link.substring(0, 35) + '...' : link}
                                </button>
                              );
                            }
                            return (
                              <a 
                                key={idx} 
                                href={link} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="embed-btn-link"
                              >
                                <ExternalLink className="w-3 h-3 mr-1" />
                                {link.length > 35 ? link.substring(0, 35) + '...' : link}
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CARD ACTIONS */}
                  <div className="discord-message-actions">
                    <button 
                      onClick={() => copyToDiscord(log)} 
                      className={`btn-action-copy ${copiedId === log.id ? 'success' : ''}`}
                    >
                      {copiedId === log.id ? (
                        <>
                          <Check className="w-4 h-4 mr-1 text-green-500" />
                          คัดลอกสำเร็จ!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-1" />
                          คัดลอกใส่ Discord
                        </>
                      )}
                    </button>

                    <button 
                      onClick={() => handleDeleteLog(log.id)} 
                      className="btn-action-delete"
                      title="ลบ log นี้"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>

      {/* ADD MANUAL ENTRY MODAL */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h2>เพิ่มบันทึกข้อมูลแอดมิน</h2>
              <button onClick={() => setShowAddModal(false)} className="btn-close-modal">&times;</button>
            </div>
            
            <form onSubmit={handleAddLog}>
              <div className="form-group">
                <label>หมวดหมู่</label>
                <select 
                  value={newLog.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>ชื่อผู้เล่น</label>
                  <input 
                    type="text" 
                    placeholder="เช่น John Doe"
                    value={newLog.player_name}
                    onChange={(e) => setNewLog({ ...newLog, player_name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>ID/Steam Hex/Discord</label>
                  <input 
                    type="text" 
                    placeholder="เช่น discord:12345 หรือ license:abc"
                    value={newLog.identifier}
                    onChange={(e) => setNewLog({ ...newLog, identifier: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>รายละเอียด/สาเหตุ *</label>
                <textarea 
                  required
                  rows="4" 
                  placeholder="กรอกรายละเอียด หรือระบุข้อความเหตุผลความผิด..."
                  value={newLog.details}
                  onChange={(e) => setNewLog({ ...newLog, details: e.target.value })}
                ></textarea>
              </div>

              <div className="form-group">
                <label>ไฟล์ภาพ (คั่นด้วยจุลภาค `,` ถ้ามีมากกว่า 1 ลิงก์)</label>
                <input 
                  type="text" 
                  placeholder="https://i.imgur.com/image.png, https://cdn.discord..."
                  value={newLog.attachments}
                  onChange={(e) => setNewLog({ ...newLog, attachments: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>ลิงก์หลักฐานแนบอื่นๆ (คั่นด้วยจุลภาค `,` ถ้ามีหลายลิงก์)</label>
                <input 
                  type="text" 
                  placeholder="https://youtube.com/watch?v=..., https://github.com..."
                  value={newLog.links}
                  onChange={(e) => setNewLog({ ...newLog, links: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <button type="button" onClick={() => setShowAddModal(false)} className="btn-secondary">ยกเลิก</button>
                <button type="submit" className="btn-submit">ยืนยันบันทึก</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IMAGE PREVIEW MODAL */}
      {previewImage && (
        <div className="image-preview-modal-backdrop" onClick={() => setPreviewImage(null)}>
          <div className="image-preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-preview-modal-close" onClick={() => setPreviewImage(null)}>&times;</button>
            <img src={previewImage} alt="Preview" className="image-preview-modal-img" />
          </div>
        </div>
      )}

      {/* VIDEO PREVIEW MODAL */}
      {previewVideo && (
        <div className="image-preview-modal-backdrop" onClick={() => setPreviewVideo(null)}>
          <div className="image-preview-modal-content video-preview-container" onClick={(e) => e.stopPropagation()}>
            <button className="image-preview-modal-close" onClick={() => setPreviewVideo(null)}>&times;</button>
            <div className="video-player-wrapper">
              {previewVideo.type === 'direct' ? (
                <video src={previewVideo.embedUrl} controls autoPlay className="video-preview-element" />
              ) : (
                <iframe 
                  src={previewVideo.embedUrl} 
                  frameBorder="0" 
                  allow="autoplay; encrypted-media" 
                  allowFullScreen 
                  className="video-preview-iframe"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
