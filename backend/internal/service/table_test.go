package service

import "testing"

func TestBuildStableOrderByClause(t *testing.T) {
	allowedCols := map[string]bool{
		"id":     true,
		"sub_id": true,
		"name":   true,
	}
	pkCols := []string{"id", "sub_id"}

	tests := []struct {
		name    string
		sortStr string
		want    string
	}{
		{
			name:    "defaults to all pk columns",
			sortStr: "",
			want:    "ORDER BY `id` ASC, `sub_id` ASC",
		},
		{
			name:    "appends all pk columns after non pk sort",
			sortStr: "name",
			want:    "ORDER BY `name` ASC, `id` ASC, `sub_id` ASC",
		},
		{
			name:    "appends only missing composite pk columns",
			sortStr: "-id",
			want:    "ORDER BY `id` DESC, `sub_id` ASC",
		},
		{
			name:    "does not duplicate pk columns already present",
			sortStr: "-id,sub_id",
			want:    "ORDER BY `id` DESC, `sub_id` ASC",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := buildStableOrderByClause(tt.sortStr, allowedCols, pkCols)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("unexpected order by clause: got %q want %q", got, tt.want)
			}
		})
	}
}
