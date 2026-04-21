export const SITE = {
  website: "https://nusmql.github.io/",
  author: "Lei",
  profile: "https://www.linkedin.com/in/meng-lei-837a0420/",
  desc: "System architect and Go engineer at Verda Cloud. Notes on CLI tooling, terminal UIs, distributed systems, and AI infrastructure.",
  title: "nusmql",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true,
  editPost: {
    enabled: false,
    text: "Edit page",
    url: "https://github.com/nusmql/nusmql.github.io/edit/main/",
  },
  dynamicOgImage: true,
  dir: "ltr",
  lang: "en",
  timezone: "Asia/Singapore",
} as const;
