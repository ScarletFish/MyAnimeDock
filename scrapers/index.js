const BangumiScraper = require('./bangumi');
const TMDBScraper = require('./tmdb');

class ScraperRegistry {
  constructor() {
    this.scrapers = [];
    this.defaultOrder = ['bangumi', 'tmdb'];
  }

  register(scraper) {
    if (!scraper.name || !scraper.search || !scraper.fetchMetadata || !scraper.downloadCover) {
      throw new Error('Scraper must implement: name, search, fetchMetadata, downloadCover');
    }
    this.scrapers.push(scraper);
    this.scrapers.sort((a, b) => {
      const ai = this.defaultOrder.indexOf(a.name);
      const bi = this.defaultOrder.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }

  get(name) {
    return this.scrapers.find(s => s.name === name);
  }

  getAll() {
    return [...this.scrapers];
  }

  getEnabled(config) {
    const enabled = this.scrapers.filter(s => {
      if (!config.scrapers) return true;
      const cfg = config.scrapers[s.name];
      return cfg?.enabled !== false;
    });
    // Sort by priority (lower number = higher priority)
    return enabled.sort((a, b) => {
      const pa = config.scrapers?.[a.name]?.priority ?? 99;
      const pb = config.scrapers?.[b.name]?.priority ?? 99;
      return pa - pb;
    });
  }

  async searchAll(keyword, config) {
    const results = [];
    for (const scraper of this.getEnabled(config)) {
      try {
        const res = await scraper.search(keyword);
        results.push(...res.map(r => ({ ...r, source: scraper.name })));
      } catch (e) {
        console.error(`[${scraper.name}] search failed:`, e.message);
      }
    }
    return results;
  }

  async fetchMetadata(scraperName, title, coverDir, subjectId, config) {
    const scraper = this.get(scraperName);
    if (!scraper) throw new Error(`Scraper not found: ${scraperName}`);
    if (!scraper.enabled(config)) throw new Error(`Scraper ${scraperName} not configured`);
    return scraper.fetchMetadata(title, coverDir, subjectId);
  }
}

const registry = new ScraperRegistry();
registry.register(new BangumiScraper());
registry.register(new TMDBScraper());

module.exports = { registry, ScraperRegistry };