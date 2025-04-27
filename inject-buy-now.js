(function() {
    // Amazon’s Buy Now variants
    console.log("🐙 inject-buy-now.js running");
    const ev = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    const btn =
      document.querySelector('#buy-now-button') ||
      document.querySelector('input[name="submit.buy-now"]');
      console.log("Found candidate:", btn); 
    if (btn) {
      btn.dispatchEvent(ev);
    }
  })();