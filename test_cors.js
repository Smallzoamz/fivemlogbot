async function test() {
  const ip = '115.76.49.36';
  try {
    const res = await fetch(`https://freeipapi.com/api/json/${ip}`);
    console.log("Access-Control-Allow-Origin:", res.headers.get("access-control-allow-origin"));
    console.log("All Headers:", [...res.headers.entries()]);
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}
test();
