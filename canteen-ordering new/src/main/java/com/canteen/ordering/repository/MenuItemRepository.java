package com.canteen.ordering.repository;

import com.canteen.ordering.model.MenuItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface MenuItemRepository extends JpaRepository<MenuItem, Long> {

    List<MenuItem> findAllByOrderByIdAsc();

    List<MenuItem> findByAvailableTrueOrderByIdAsc();
}
