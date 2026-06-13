const parseLogDetails = (detailsText) => {
  if (!detailsText) return { description: '', fields: [] };
  
  const lines = detailsText.split('\n');
  const descriptionLines = [];
  const fields = [];
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0 && colonIndex < trimmed.length - 1) {
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      
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
  
  const hasPlayerName = finalFields.some(f => {
    const k = f.key.toLowerCase();
    return k === 'player' || k === 'player name' || k === 'nameplayer' || k === 'ผู้เล่น' || k === 'ชื่อผู้เล่น';
  });
  if (!hasPlayerName && log.player_name) {
    const keyLabel = log.ticket_id ? 'ผู้แจ้ง' : 'ผู้เล่น';
    finalFields.unshift({ key: keyLabel, value: log.player_name, isReporter: !!log.ticket_id });
  }
  
  const hasIdentifier = finalFields.some(f => {
    const k = f.key.toLowerCase();
    return k === 'identifier' || k === 'id/hex' || k === 'hex' || k === 'discord id' || k === 'steam hex' || k === 'steam id';
  });
  if (!hasIdentifier && log.identifier) {
    const keyLabel = log.ticket_id ? 'Discord ID ผู้แจ้ง' : 'ID/Hex';
    finalFields.push({ key: keyLabel, value: log.identifier, isReporter: !!log.ticket_id });
  }

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

const logObj = {
  id: 123,
  category: 'INTER_REGISTER',
  player_name: 'EnTee Dekflawless',
  identifier: 'discord:438954812114075649',
  details: `ประเทศที่เล่น : VIET NAM
รัฐที่อยู่ : Dong Nai City
ID Discord : 438954812114075649
ชื่อ-นามสกุล IC ผู้เล่น : EnTee Dekflawless
การหา SERVER IP(IPv4): 115.76.49.36`,
  attachments: [],
  links: [],
  created_by: 'ohmphieang_',
  created_at: '2026-06-13T15:52:13Z'
};

const { description, playerFields, otherFields } = getFormattedFields(logObj);
console.log("description:", description);
console.log("playerFields:", playerFields);
console.log("otherFields:", otherFields);

const ip = extractIpAddress(logObj, playerFields, otherFields);
console.log("Extracted IP:", ip);
