const details = `ประเทศที่เล่น : VIET NAM
รัฐที่อยู่ : Dong Nai City
ID Discord : 438954812114075649
ชื่อ-นามสกุล IC ผู้เล่น : EnTee Dekflawless
การหา SERVER IP(IPv4): 115.76.49.36`;

const ipRegex = /\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b/; // Wait, in JavaScript regex literal it is /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
const ipRegexLiteral = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

console.log("Regex literal match:", details.match(ipRegexLiteral));
