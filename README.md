Solution

I used node.js with nest.js and typescript, used piscina.js as worker pool management, because the process of validate address is CPU bound and if run it on main thread, will block the event-loop, will be less responsiveness and wont scale well.

The fist data structure came to my mind was Trie, because I already worked in the past and used Trie for auto-complete feature,
but here I did not used pure Trie structure, used Maps with suffix and abbreviations, and implemented a lookup algorithm similar of search of Trie, using Regex.

For What I used LLM`s? 

I mainly used for Regex patterns (like always :D), and I asked to Claude generate the unit tests and I refactored some, but few are failing yet. (Had no time to fix).

NOTE: I spent 7 hours in the challenge because my current job is taking all my time, and I have 2 kids, so...

What way I would use to solve this problem if the address data is inside my database?

Recently I wrote a feature where we get a lot of CPE data and ingest this in database and we have an UI to free search, so I used <% (word_ similarity), to filter which part of the input search,
here is the query, my first version was using similarity function that compared the entire line of the input, but I like to tune code, and I saw that splitting the parts of the input using word_similarity is 3-4x faster.

Here is the real query I wrote in my job:
```bash
WITH pre_filter AS (
  SELECT
  *,
  word_similarity(SPLIT_PART(cpe_name, ':', 4), 'pass') AS "confidence_vendor",
  word_similarity(SPLIT_PART(cpe_name, ':', 5), 'pass') AS "confidence_product",
        CASE
          WHEN "version" = '1.1' THEN 1
          ELSE 0
          END AS "confidence_version"
        FROM
         cpe
        WHERE
            deprecated = false
            AND
            'pass' <% cpe_name
            )
        SELECT
        *
        FROM
        pre_filter
        WHERE
            "version" = '1.1'
            AND
            ("target_sw" = ANY(ARRAY['1', '2']) OR "target_sw" = '*')
            AND
            (confidence_product + confidence_vendor >= 0.5)
        ORDER BY
        GREATEST(confidence_product + confidence_version, confidence_vendor + confidence_version) DESC,
        confidence_product DESC,
        version DESC
        LIMIT 1;
```
What else I would do if had more time?

I would organize the regex patterns in one place in the code and use variable names that match with each regex pattern.

I would think in a strategy of cache for this feature, which is not so obvious.

I would use docker with helm values of HPA on k8s.

I would implement rate-limiter, in infra level like nginx or AWS WAF.

I would implement better logging of the process, to be easy to troubleshooting errors in prod.

I would use some library to prevent dangerous regex operations.

I would setup observability with grafana, prometheus and thanos.

## Requisites

node.js v23.x


## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

```

