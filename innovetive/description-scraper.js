(() => {
  try {
    let description = '';

    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const records = Array.isArray(data) ? data : [data];

        for (const record of records) {
          if (record && record.description) {
            description = record.description
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            break;
          }
        }

        if (description) break;
      } catch (error) {}
    }

    if (!description) {
      const pageText = document.body?.innerText || '';
      description = pageText.replace(/\s+/g, ' ').trim().substring(0, 500);
    }

    return description;
  } catch (error) {
    return '';
  }
})();
