async function test() {
  const ip = '115.76.49.36';
  try {
    const res = await fetch(`https://freeipapi.com/api/json/${ip}`);
    const data = await res.json();
    console.log("Response data:", data);
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}
test();
