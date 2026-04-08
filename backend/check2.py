import psycopg2
conn = psycopg2.connect('postgresql://admin:admin123@localhost:5432/finops_db')
cur = conn.cursor()

# Total par service_name dans chaque mois
cur.execute("""
    SELECT 
        COALESCE(j.service_name, f.service_name) as service,
        ROUND(COALESCE(j.total,0)::numeric, 2) as jan,
        ROUND(COALESCE(f.total,0)::numeric, 2) as fev,
        ROUND((COALESCE(f.total,0) - COALESCE(j.total,0))::numeric, 2) as diff
    FROM 
        (SELECT service_name, SUM(amount) as total FROM cost_records
         WHERE DATE_TRUNC('month', cost_date) = '2026-01-01' AND amount > 0
         GROUP BY service_name) j
    FULL OUTER JOIN
        (SELECT service_name, SUM(amount) as total FROM cost_records
         WHERE DATE_TRUNC('month', cost_date) = '2026-02-01' AND amount > 0
         GROUP BY service_name) f
    ON j.service_name = f.service_name
    WHERE ABS(COALESCE(f.total,0) - COALESCE(j.total,0)) > 0.01
    ORDER BY diff DESC
""")
rows = cur.fetchall()
print(f"Services avec differences Janvier vs Fevrier ({len(rows)}):")
total_diff = 0
for r in rows:
    print(f"  jan={r[1]:8.2f} fev={r[2]:8.2f} diff={r[3]:8.2f} | {r[0][:50]}")
    total_diff += float(r[3])
print(f"\nTotal differences = {round(total_diff, 2)} EUR")
print(f"Ecart attendu     = 54.12 EUR")

conn.close()